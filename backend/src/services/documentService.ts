import { prisma } from '../db.js'
import type { Document } from '@prisma/client'

export async function getDocumentByRoomCode(roomCode: string): Promise<Document | null> {
  return prisma.document.findFirst({
    where: { room: { roomCode: roomCode.toUpperCase() } },
  })
}

export async function getDocumentById(documentId: string): Promise<Document | null> {
  return prisma.document.findUnique({ where: { id: documentId } })
}

/**
 * Persist the Yjs document state + plain markdown content for a room.
 * Called (debounced) whenever the collaborative document changes.
 */
export async function saveDocumentState(
  roomCode: string,
  content: string,
  state: Uint8Array,
): Promise<void> {
  await prisma.document.updateMany({
    where: { room: { roomCode: roomCode.toUpperCase() } },
    data: { content, state: Buffer.from(state), updatedAt: new Date() },
  })
}

export async function bumpDocumentVersion(roomCode: string, version: number): Promise<void> {
  await prisma.document.updateMany({
    where: { room: { roomCode: roomCode.toUpperCase() } },
    data: { version },
  })
}
