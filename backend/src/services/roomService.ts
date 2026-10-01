import { prisma } from '../db.js'
import { HttpError, type Permission, type RoomAccess } from '../types.js'
import { generateRoomCode, randomUserColor } from '../utils/roomCode.js'
import { serializeRoom, serializeMember, serializeDocument } from '../utils/serialize.js'

const MAX_ROOM_CODE_ATTEMPTS = 10

async function uniqueRoomCode(): Promise<string> {
  for (let i = 0; i < MAX_ROOM_CODE_ATTEMPTS; i++) {
    const code = generateRoomCode(6)
    const existing = await prisma.room.findUnique({ where: { roomCode: code } })
    if (!existing) return code
  }
  throw new HttpError(500, 'Failed to generate a unique room code')
}

export const WELCOME_TEMPLATE = `# Welcome to CollabMD

This room is a **real-time collaborative** Markdown document. Everyone in the room sees edits instantly — no refresh, no merge conflicts.

## What you can do

- **Write Markdown** in the left pane and watch the live preview on the right
- **Draw diagrams** with Mermaid — they render live as you type
- **Collaborate** — open this room in a second tab or laptop and watch each other's cursors
- **Version history** — every quiet period is captured; restore any point in time
- **Export** — download your document as Markdown, self-contained HTML, or PDF

## Mermaid example

\`\`\`mermaid
graph TD
    A[React Frontend] -->|WebSocket| B[CollabMD Server]
    B --> C[(PostgreSQL)]
    B --> D[Yjs CRDT Document]
    D --> A
\`\`\`

## Runnable code

Put your cursor inside this block and press **Run Code** (or \`Ctrl+Enter\`):

\`\`\`javascript
const team = ['Alice', 'Bob', 'Carol'];
console.log('Hello from CollabMD!');
console.log('Team size:', team.length);
console.log('Doubled:', [1, 2, 3].map(n => n * 2).join(', '));
\`\`\`

## Try it out

1. Open this room in another browser tab
2. Type something — the other tab updates instantly
3. Open **History** in the toolbar to see versions appear as you edit
4. Open **Export** to download this document

> Tip: use the **Share** button to copy the room link and invite your team.
`

export async function createRoom(input: {
  name: string
  displayName: string
  access: RoomAccess
  token?: string
}) {
  const access: RoomAccess = input.access === 'view' ? 'view' : 'edit'

  // Reuse the caller's anonymous identity when a valid token is presented.
  let user = null
  if (input.token) {
    user = await prisma.user.findUnique({ where: { token: input.token } })
  }
  if (!user) {
    user = await prisma.user.create({
      data: {
        token: crypto.randomUUID(),
        name: input.displayName,
        color: randomUserColor(),
      },
    })
  } else if (input.displayName && user.name !== input.displayName) {
    user = await prisma.user.update({ where: { id: user.id }, data: { name: input.displayName } })
  }

  const roomCode = await uniqueRoomCode()

  const room = await prisma.room.create({
    data: {
      roomCode,
      name: input.name,
      defaultPermission: access,
      ownerId: user.id,
      members: {
        create: { userId: user.id, permission: 'OWNER' },
      },
      document: {
        create: { content: WELCOME_TEMPLATE },
      },
    },
    include: { members: { include: { user: true } }, document: true },
  })

  return {
    user: { id: user.id, token: user.token, name: user.name, color: user.color },
    room: serializeRoom(room),
    members: room.members.map(serializeMember),
    document: serializeDocument(room.document!),
  }
}

export async function joinRoom(input: { roomCode: string; displayName: string; token?: string }) {
  const room = await prisma.room.findUnique({
    where: { roomCode: input.roomCode.toUpperCase() },
    include: { members: { include: { user: true } }, document: true },
  })
  if (!room) {
    throw new HttpError(404, `Room "${input.roomCode}" not found. Check the code and try again.`)
  }

  let user = null
  if (input.token) {
    user = await prisma.user.findUnique({ where: { token: input.token } })
  }
  if (!user) {
    user = await prisma.user.create({
      data: {
        token: crypto.randomUUID(),
        name: input.displayName,
        color: randomUserColor(),
      },
    })
  } else if (input.displayName && user.name !== input.displayName) {
    user = await prisma.user.update({ where: { id: user.id }, data: { name: input.displayName } })
  }

  // Membership: reuse existing, otherwise grant the room's default link permission.
  let membership = room.members.find((m) => m.userId === user!.id)
  if (!membership) {
    const permission: Permission = room.defaultPermission === 'view' ? 'VIEWER' : 'EDITOR'
    membership = await prisma.roomMember.create({
      data: { roomId: room.id, userId: user!.id, permission },
      include: { user: true },
    })
  }

  return {
    user: { id: user.id, token: user.token, name: user.name, color: user.color },
    room: serializeRoom(room),
    members: [...room.members, membership]
      .filter((m, idx, arr) => arr.findIndex((x) => x.id === m.id) === idx)
      .map(serializeMember),
    permission: membership.permission,
    document: serializeDocument(room.document!),
  }
}

export async function getRoomByCode(roomCode: string) {
  const room = await prisma.room.findUnique({
    where: { roomCode: roomCode.toUpperCase() },
    include: { members: { include: { user: true } }, document: true },
  })
  if (!room) throw new HttpError(404, 'Room not found')
  return room
}

export async function updateRoom(
  roomCode: string,
  data: { name?: string; defaultPermission?: RoomAccess; locked?: boolean },
) {
  const room = await prisma.room.update({
    where: { roomCode: roomCode.toUpperCase() },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.defaultPermission !== undefined
        ? { defaultPermission: data.defaultPermission === 'view' ? 'view' : 'edit' }
        : {}),
      ...(data.locked !== undefined ? { locked: data.locked } : {}),
    },
  })
  return serializeRoom(room)
}

export async function setMemberPermission(roomCode: string, userId: string, permission: Permission) {
  const room = await getRoomByCode(roomCode)
  if (userId === room.ownerId) {
    throw new HttpError(400, 'The owner permission cannot be changed')
  }
  const member = room.members.find((m) => m.userId === userId)
  if (!member) throw new HttpError(404, 'Member not found')
  const updated = await prisma.roomMember.update({
    where: { id: member.id },
    data: { permission },
    include: { user: true },
  })
  return serializeMember(updated)
}

export async function removeMember(roomCode: string, userId: string) {
  const room = await getRoomByCode(roomCode)
  if (userId === room.ownerId) {
    throw new HttpError(400, 'The owner cannot be removed from the room')
  }
  const member = room.members.find((m) => m.userId === userId)
  if (!member) throw new HttpError(404, 'Member not found')
  await prisma.roomMember.delete({ where: { id: member.id } })
}
