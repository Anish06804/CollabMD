import { prisma } from '../db.js'
import { HttpError } from '../types.js'
import { serializeVersion } from '../utils/serialize.js'
import { getLiveRoomDoc } from './collaborationRegistry.js'
import * as Y from 'yjs'

const MAX_VERSIONS_PER_DOCUMENT = 100
const AUTO_VERSION_QUIET_MS = 30_000

export async function listVersions(roomCode: string) {
  const doc = await prisma.document.findFirst({
    where: { room: { roomCode: roomCode.toUpperCase() } },
    include: {
      versions: {
        orderBy: { versionNumber: 'desc' },
        include: { createdBy: true },
        take: 200,
      },
    },
  })
  if (!doc) throw new HttpError(404, 'Document not found')
  return doc.versions.map(serializeVersion)
}

export async function createVersion(documentId: string, content: string, createdById: string | null) {
  const doc = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
  })
  const nextNumber = (doc.versions[0]?.versionNumber ?? 0) + 1
  const version = await prisma.documentVersion.create({
    data: { documentId, content, versionNumber: nextNumber, createdById },
    include: { createdBy: true },
  })
  await prisma.document.update({
    where: { id: documentId },
    data: { version: nextNumber },
  })
  await trimVersions(documentId)
  return version
}

async function trimVersions(documentId: string) {
  const excess = await prisma.documentVersion.findMany({
    where: { documentId },
    orderBy: { versionNumber: 'desc' },
    skip: MAX_VERSIONS_PER_DOCUMENT,
    select: { id: true },
  })
  if (excess.length > 0) {
    await prisma.documentVersion.deleteMany({
      where: { id: { in: excess.map((v) => v.id) } },
    })
  }
}

/**
 * Auto-version: capture a version when the content has been quiet for a while.
 * Called after every debounced persistence flush.
 */
export async function maybeAutoVersion(roomCode: string, content: string): Promise<void> {
  const doc = await prisma.document.findFirst({
    where: { room: { roomCode: roomCode.toUpperCase() } },
    include: { versions: { orderBy: { createdAt: 'desc' }, take: 1 } },
  })
  if (!doc) return
  const last = doc.versions[0]
  if (last && last.content === content) return
  if (last && Date.now() - last.createdAt.getTime() < AUTO_VERSION_QUIET_MS) return
  await createVersion(doc.id, content, null)
}

/**
 * Restore a version. When the room has live collaborators the Yjs document is
 * updated in place (which syncs to every connected client); otherwise the
 * persisted state is rebuilt from the markdown content.
 */
export async function restoreVersion(versionId: string, restoredById: string | null) {
  const version = await prisma.documentVersion.findUnique({
    where: { id: versionId },
    include: { document: { include: { room: true } } },
  })
  if (!version) throw new HttpError(404, 'Version not found')

  const roomCode = version.document.room.roomCode
  const live = getLiveRoomDoc(roomCode)
  if (live) {
    const ytext = live.getText('markdown')
    live.transact(() => {
      ytext.delete(0, ytext.length)
      ytext.insert(0, version.content)
    })
    // The doc 'update' event triggers persistence; record the restore as a
    // new version so the restore itself is undoable.
    await createVersion(version.documentId, version.content, restoredById)
  } else {
    const tmp = new Y.Doc()
    const ytext = tmp.getText('markdown')
    ytext.insert(0, version.content)
    const state = Y.encodeStateAsUpdate(tmp)
    await prisma.document.update({
      where: { id: version.documentId },
      data: { content: version.content, state: Buffer.from(state) },
    })
    await createVersion(version.documentId, version.content, restoredById)
  }
}
