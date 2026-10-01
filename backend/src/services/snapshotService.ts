import { prisma } from '../db.js'
import { HttpError } from '../types.js'
import { serializeSnapshot } from '../utils/serialize.js'
import { getLiveRoomDoc } from './collaborationRegistry.js'
import * as Y from 'yjs'

export async function listSnapshots(roomCode: string) {
  const doc = await prisma.document.findFirst({
    where: { room: { roomCode: roomCode.toUpperCase() } },
    include: { snapshots: { orderBy: { createdAt: 'desc' }, include: { createdBy: true } } },
  })
  if (!doc) throw new HttpError(404, 'Document not found')
  return doc.snapshots.map(serializeSnapshot)
}

export async function createSnapshot(roomCode: string, name: string, createdById: string | null) {
  const doc = await prisma.document.findFirst({
    where: { room: { roomCode: roomCode.toUpperCase() } },
    include: { snapshots: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  if (!doc) throw new HttpError(404, 'Document not found')

  // Prefer the live collaborative content so the snapshot matches the screen.
  const live = getLiveRoomDoc(roomCode)
  const content = live ? live.getText('markdown').toString() : doc.content

  const snapshot = await prisma.snapshot.create({
    data: { documentId: doc.id, name, content, createdById },
    include: { createdBy: true },
  })
  return serializeSnapshot(snapshot)
}

export async function restoreSnapshot(snapshotId: string) {
  const snapshot = await prisma.snapshot.findUnique({
    where: { id: snapshotId },
    include: { document: { include: { room: true } } },
  })
  if (!snapshot) throw new HttpError(404, 'Snapshot not found')

  const roomCode = snapshot.document.room.roomCode
  const live = getLiveRoomDoc(roomCode)
  if (live) {
    const ytext = live.getText('markdown')
    live.transact(() => {
      ytext.delete(0, ytext.length)
      ytext.insert(0, snapshot.content)
    })
  } else {
    const tmp = new Y.Doc()
    const ytext = tmp.getText('markdown')
    ytext.insert(0, snapshot.content)
    const state = Y.encodeStateAsUpdate(tmp)
    await prisma.document.update({
      where: { id: snapshot.documentId },
      data: { content: snapshot.content, state: Buffer.from(state) },
    })
  }
}

export async function deleteSnapshot(snapshotId: string) {
  const snapshot = await prisma.snapshot.findUnique({ where: { id: snapshotId } })
  if (!snapshot) throw new HttpError(404, 'Snapshot not found')
  await prisma.snapshot.delete({ where: { id: snapshotId } })
}
