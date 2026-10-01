import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { prisma } from '../db.js'
import { saveDocumentState } from './documentService.js'
import { maybeAutoVersion } from './versionService.js'

export interface RoomCollab {
  roomCode: string
  doc: Y.Doc
  awareness: Awareness
  connections: number
  /** Host viewing-mode lock — mirrored into the doc's roomMeta map. */
  locked: boolean
  dirty: boolean
  flushTimer: NodeJS.Timeout | null
  unloadTimer: NodeJS.Timeout | null
}

const PERSIST_DEBOUNCE_MS = 800
const UNLOAD_AFTER_MS = 10 * 60 * 1000

const rooms = new Map<string, RoomCollab>()
const loading = new Map<string, Promise<RoomCollab>>()

export function getLiveRoomDoc(roomCode: string): Y.Doc | null {
  return rooms.get(roomCode.toUpperCase())?.doc ?? null
}

export function getRoomCollab(roomCode: string): RoomCollab | null {
  return rooms.get(roomCode.toUpperCase()) ?? null
}

export function getRoomMembersOnline(roomCode: string): number {
  return rooms.get(roomCode.toUpperCase())?.connections ?? 0
}

/**
 * Load (or create) the in-memory Yjs document for a room, restoring the
 * persisted binary state from PostgreSQL when available. Concurrent callers
 * share the same load promise so the document is only created once.
 */
export function getOrCreateRoomCollab(roomCode: string): Promise<RoomCollab> {
  const code = roomCode.toUpperCase()
  const existing = rooms.get(code)
  if (existing) {
    if (existing.unloadTimer) {
      clearTimeout(existing.unloadTimer)
      existing.unloadTimer = null
    }
    return Promise.resolve(existing)
  }
  const pending = loading.get(code)
  if (pending) return pending

  const promise = (async (): Promise<RoomCollab> => {
    const doc = new Y.Doc({ gc: true })
    const awareness = new Awareness(doc)

    const record = await prisma.document.findFirst({
      where: { room: { roomCode: code } },
      include: { room: { select: { locked: true } } },
    })
    if (record?.state && record.state.length > 0) {
      Y.applyUpdate(doc, new Uint8Array(record.state))
    } else if (record?.content) {
      // New room: initialize the Yjs doc from the stored markdown content
      // (e.g. the welcome template) so clients see it on first connect.
      doc.getText('markdown').insert(0, record.content)
    }

    const locked = record?.room.locked ?? false
    const collab: RoomCollab = {
      roomCode: code,
      doc,
      awareness,
      connections: 0,
      locked,
      dirty: false,
      flushTimer: null,
      unloadTimer: null,
    }

    doc.on('update', () => {
      collab.dirty = true
      scheduleFlush(collab)
    })

    // Seed the viewing-mode flag into the shared doc so clients receive it in
    // their initial sync (the DB row Room.locked remains the source of truth).
    const meta = doc.getMap<boolean>('roomMeta')
    if (meta.get('locked') !== locked) {
      doc.transact(() => meta.set('locked', locked), 'server-init')
    }

    rooms.set(code, collab)
    loading.delete(code)
    return collab
  })().catch((err) => {
    loading.delete(code)
    throw err
  })

  loading.set(code, promise)
  return promise
}

function scheduleFlush(collab: RoomCollab) {
  if (collab.flushTimer) return
  collab.flushTimer = setTimeout(() => {
    collab.flushTimer = null
    void flushRoom(collab)
  }, PERSIST_DEBOUNCE_MS)
}

export async function flushRoom(collab: RoomCollab): Promise<void> {
  if (collab.flushTimer) {
    clearTimeout(collab.flushTimer)
    collab.flushTimer = null
  }
  if (!collab.dirty) return
  collab.dirty = false
  const content = collab.doc.getText('markdown').toString()
  const state = Y.encodeStateAsUpdate(collab.doc)
  try {
    await saveDocumentState(collab.roomCode, content, state)
    await maybeAutoVersion(collab.roomCode, content)
  } catch (err) {
    console.error(`[collab] failed to persist ${collab.roomCode}:`, err)
    collab.dirty = true // retry on the next update
  }
}

/**
 * Host viewing-mode lock: update the live room and mirror the flag into the
 * shared Yjs doc's `roomMeta` map. The doc 'update' relay broadcasts it to
 * every connected client instantly; persistence follows the normal debounce.
 * (No-op when the room isn't loaded — Room.locked in Postgres is re-read on
 * the next load.)
 */
export function setRoomLock(roomCode: string, locked: boolean): void {
  const collab = rooms.get(roomCode.toUpperCase())
  if (!collab) return
  collab.locked = locked
  const meta = collab.doc.getMap<boolean>('roomMeta')
  if (meta.get('locked') !== locked) {
    collab.doc.transact(() => meta.set('locked', locked), 'server-lock')
  }
}

export function markConnectionClosed(collab: RoomCollab) {
  collab.connections = Math.max(0, collab.connections - 1)
  if (collab.connections === 0) {
    // Flush immediately, then unload the doc after a grace period so a
    // reconnecting client gets a fast in-memory handshake.
    void flushRoom(collab)
    if (collab.unloadTimer) clearTimeout(collab.unloadTimer)
    collab.unloadTimer = setTimeout(() => {
      if (collab.connections > 0) return
      void flushRoom(collab).then(() => {
        if (collab.connections > 0) return
        collab.awareness.destroy()
        collab.doc.destroy()
        rooms.delete(collab.roomCode)
      })
    }, UNLOAD_AFTER_MS)
  }
}

export async function shutdownAll(): Promise<void> {
  const all = [...rooms.values()]
  await Promise.all(all.map((c) => flushRoom(c)))
  for (const c of all) {
    c.awareness.destroy()
    c.doc.destroy()
  }
  rooms.clear()
}
