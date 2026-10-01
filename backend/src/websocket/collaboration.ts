import type { IncomingMessage } from 'http'
import { WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import {
  getOrCreateRoomCollab,
  getRoomCollab,
  setRoomLock,
  markConnectionClosed,
  type RoomCollab,
} from '../services/collaborationRegistry.js'
import { prisma } from '../db.js'
import { HttpError, type Permission } from '../types.js'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const MESSAGE_QUERY_AWARENESS = 3

interface SocketMeta {
  roomCode: string
  userId: string
  permission: Permission
  collab: RoomCollab
  /** Browser Yjs clientIDs whose awareness state arrived via this socket. */
  clientIDs: Set<number>
}

const meta = new WeakMap<WebSocket, SocketMeta>()
const roomSockets = new Map<string, Set<WebSocket>>()

/**
 * Relay handlers are registered ONCE per room (not once per connection).
 *
 * This matters: the shared Y.Doc fires 'update' for every listener. If each
 * connection added its own listener, a single incoming update would be
 * broadcast N times, and all listeners except the author's would echo the
 * update back to its author. Registering one handler per room and excluding
 * only the originating socket gives each update exactly one relay.
 */
interface RoomRelay {
  onDocUpdate: (update: Uint8Array, origin: unknown) => void
  onAwarenessUpdate: (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => void
}
const relays = new Map<string, RoomRelay>()

function send(ws: WebSocket, data: Uint8Array) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(data)
  }
}

function broadcastToRoom(collab: RoomCollab, data: Uint8Array, origin: WebSocket | null) {
  const sockets = roomSockets.get(collab.roomCode)
  if (!sockets) return
  for (const conn of sockets) {
    if (conn !== origin && conn.readyState === WebSocket.OPEN) {
      conn.send(data)
    }
  }
}

/** Register the single relay handler for a room. Idempotent per room. */
function ensureRelay(collab: RoomCollab): void {
  if (relays.has(collab.roomCode)) return

  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    // `origin` is the socket the update arrived from (or null for local
    // server-side changes) — exclude only that socket so the author doesn't
    // receive its own update back.
    const from = origin instanceof WebSocket ? origin : null
    broadcastToRoom(collab, encoding.toUint8Array(encoder), from)
  }

  const onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    const changed = [...added, ...updated, ...removed]
    if (changed.length === 0) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(collab.awareness, changed),
    )
    const from = origin instanceof WebSocket ? origin : null
    broadcastToRoom(collab, encoding.toUint8Array(encoder), from)
  }

  collab.doc.on('update', onDocUpdate)
  collab.awareness.on('update', onAwarenessUpdate)
  relays.set(collab.roomCode, { onDocUpdate, onAwarenessUpdate })
}

/** Detach a room's relay handler (used when the last connection closes). */
function removeRelay(collab: RoomCollab): void {
  const relay = relays.get(collab.roomCode)
  if (!relay) return
  collab.doc.off('update', relay.onDocUpdate)
  collab.awareness.off('update', relay.onAwarenessUpdate)
  relays.delete(collab.roomCode)
}

function sendSyncStep1(ws: WebSocket, collab: RoomCollab) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(encoder, collab.doc)
  send(ws, encoding.toUint8Array(encoder))

  const states = collab.awareness.getStates()
  if (states.size > 0) {
    const encoder2 = encoding.createEncoder()
    encoding.writeVarUint(encoder2, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      encoder2,
      awarenessProtocol.encodeAwarenessUpdate(collab.awareness, Array.from(states.keys())),
    )
    send(ws, encoding.toUint8Array(encoder2))
  }
}

function handleMessage(ws: WebSocket, collab: RoomCollab, data: Uint8Array) {
  const m = meta.get(ws)
  if (!m) return

  // Effective read-only access, computed per message so a host lock toggle
  // applies to already-connected sockets immediately (no reconnect needed):
  //   • VIEWER connections are always read-only;
  //   • while the room is locked (viewing mode) everyone except the host
  //     (permission OWNER) is read-only — server-side, not just UI.
  const readOnly = m.permission === 'VIEWER' || (collab.locked && m.permission !== 'OWNER')

  const decoder = decoding.createDecoder(data)
  const messageType = decoding.readVarUint(decoder)

  if (messageType === MESSAGE_SYNC) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    // Peek at the inner sync message type. SyncStep1 only reads the peer's
    // state vector and writes the diff reply — it never mutates the document,
    // so it is safe for read-only connections. SyncStep2 / Update
    // mutate the document and are dropped for read-only connections, which
    // enforces read-only access server-side.
    const innerType = decoding.readVarUint(decoder)
    if (innerType === syncProtocol.messageYjsSyncStep1) {
      syncProtocol.readSyncStep1(decoder, encoder, collab.doc)
    } else if (!readOnly && innerType === syncProtocol.messageYjsSyncStep2) {
      // Pass `ws` as the update origin so the room's single relay handler
      // knows which socket to exclude when broadcasting.
      syncProtocol.readSyncStep2(decoder, collab.doc, ws)
    } else if (!readOnly && innerType === syncProtocol.messageYjsUpdate) {
      syncProtocol.readUpdate(decoder, collab.doc, ws)
    } else if (readOnly) {
      // Read-only connections may not mutate the document — drop silently.
      return
    }
    if (encoding.length(encoder) > 1) {
      send(ws, encoding.toUint8Array(encoder))
    }
    return
  }

  if (messageType === MESSAGE_AWARENESS) {
    const update = decoding.readVarUint8Array(decoder)
    // Track which browser clientIDs belong to this socket so their cursor /
    // presence state can be removed when the socket goes away.
    const reader = decoding.createDecoder(update)
    const len = decoding.readVarUint(reader)
    for (let i = 0; i < len; i++) {
      m.clientIDs.add(decoding.readVarUint(reader))
    }
    awarenessProtocol.applyAwarenessUpdate(collab.awareness, update, ws)
    return
  }

  if (messageType === MESSAGE_QUERY_AWARENESS) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(
        collab.awareness,
        Array.from(collab.awareness.getStates().keys()),
      ),
    )
    send(ws, encoding.toUint8Array(encoder))
  }
}

async function authorize(
  req: IncomingMessage,
): Promise<{ roomCode: string; userId: string; permission: Permission }> {
  const url = new URL(req.url || '', 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean)
  // Expected path: /ws/:roomCode?token=...
  if (parts[0] !== 'ws' || parts.length < 2) {
    throw new HttpError(404, 'Not found')
  }
  const roomCode = decodeURIComponent(parts[1])
  const token = url.searchParams.get('token') || ''

  const room = await prisma.room.findUnique({
    where: { roomCode: roomCode.toUpperCase() },
    include: { members: true },
  })
  if (!room) throw new HttpError(404, 'Room not found')

  const user = token ? await prisma.user.findUnique({ where: { token } }) : null
  if (!user) throw new HttpError(401, 'Invalid or missing token')

  const membership = room.members.find((m) => m.userId === user.id)
  if (!membership) throw new HttpError(403, 'You are not a member of this room')

  return { roomCode: room.roomCode, userId: user.id, permission: membership.permission }
}

function toUint8Array(message: ArrayBuffer | Buffer): Uint8Array {
  return message instanceof ArrayBuffer
    ? new Uint8Array(message)
    : new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
}

export async function handleWebSocketUpgrade(req: IncomingMessage, socket: WebSocket) {
  // Clients send syncStep1 (their request for the document) the instant the
  // socket opens — but we must await authorization and room loading first.
  // A listener attached only after those awaits would drop that first message,
  // leaving the client permanently empty. Buffer everything that arrives
  // during setup and replay it in order once the handler is ready.
  const pending: Uint8Array[] = []
  let dispatch: ((data: Uint8Array) => void) | null = null

  socket.on('message', (message: ArrayBuffer | Buffer) => {
    const data = toUint8Array(message)
    if (dispatch) dispatch(data)
    else pending.push(data)
  })

  let auth: { roomCode: string; userId: string; permission: Permission }
  try {
    auth = await authorize(req)
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    socket.close(status >= 400 && status < 500 ? 4000 + status : 1111, 'Unauthorized')
    return
  }

  let collab: RoomCollab
  try {
    collab = await getOrCreateRoomCollab(auth.roomCode)
  } catch (err) {
    // A failed room load must never take the whole server down — an
    // unhandled rejection here would kill every other room's connection.
    console.error('[ws] failed to load room:', err)
    socket.close(1111, 'Room unavailable')
    return
  }
  collab.connections += 1

  let sockets = roomSockets.get(collab.roomCode)
  if (!sockets) {
    sockets = new Set()
    roomSockets.set(collab.roomCode, sockets)
  }
  sockets.add(socket)
  meta.set(socket, {
    roomCode: collab.roomCode,
    userId: auth.userId,
    permission: auth.permission,
    collab,
    clientIDs: new Set(),
  })

  // Register the room's single relay handler (idempotent). Document and
  // awareness updates are broadcast exactly once, excluding their origin.
  ensureRelay(collab)

  dispatch = (data: Uint8Array) => {
    try {
      handleMessage(socket, collab, data)
    } catch (err) {
      console.error('[ws] failed to handle message:', err)
    }
  }

  // Replay anything that arrived while we were authenticating/loading.
  const buffered = pending.splice(0, pending.length)
  for (const data of buffered) dispatch(data)

  const cleanup = () => {
    sockets?.delete(socket)
    if (sockets && sockets.size === 0) {
      roomSockets.delete(collab.roomCode)
      // Last connection left — stop relaying until someone reconnects.
      removeRelay(collab)
    }
    // Remove the disconnected client's cursor / presence states.
    const m = meta.get(socket)
    if (m && m.clientIDs.size > 0) {
      awarenessProtocol.removeAwarenessStates(collab.awareness, [...m.clientIDs], 'connection closed')
    }
    meta.delete(socket)
    markConnectionClosed(collab)
  }

  socket.on('close', cleanup)
  socket.on('error', cleanup)

  // Initial handshake: send our state vector so the client can diff,
  // plus the current awareness states (cursors/presence).
  sendSyncStep1(socket, collab)
}

/**
 * The host toggled viewing mode — notify every connected client.
 *
 * 1. `setRoomLock` flips the live room's flag and mirrors it into the shared
 *    doc's `roomMeta` map, which the per-room relay broadcasts to all sockets
 *    (the UI switches between editing/viewing instantly, no reload).
 * 2. On UNLOCK, every socket is sent syncStep1. Clients answer with a diff of
 *    their document against our state vector — this re-applies any edits that
 *    were silently dropped while the lock was active, so a client that typed
 *    right as the lock landed cannot end up diverged from the room.
 */
export function notifyRoomLockChanged(roomCode: string, locked: boolean): void {
  const code = roomCode.toUpperCase()
  setRoomLock(code, locked)
  if (locked) return
  const collab = getRoomCollab(code)
  const sockets = roomSockets.get(code)
  if (!collab || !sockets) return
  for (const ws of sockets) {
    sendSyncStep1(ws, collab)
  }
}
