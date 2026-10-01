import { Router } from 'express'
import { z } from 'zod'
import { requireUser, requireMember, requireEditor } from '../middleware/auth.js'
import { getDocumentByRoomCode } from '../services/documentService.js'
import { serializeDocument } from '../utils/serialize.js'
import { listVersions, createVersion, restoreVersion } from '../services/versionService.js'
import { listSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot } from '../services/snapshotService.js'
import { HttpError } from '../types.js'

export const documentsRouter = Router()

// All document routes require authentication + membership.
documentsRouter.use(requireUser, requireMember)

// GET /api/documents/:roomCode — current document content
documentsRouter.get('/:roomCode', async (req, res, next) => {
  try {
    const doc = await getDocumentByRoomCode(req.params.roomCode)
    if (!doc) throw new HttpError(404, 'Document not found')
    res.json({ document: serializeDocument(doc) })
  } catch (err) {
    next(err)
  }
})

// GET /api/documents/:roomCode/versions — version history
documentsRouter.get('/:roomCode/versions', async (req, res, next) => {
  try {
    res.json({ versions: await listVersions(req.params.roomCode) })
  } catch (err) {
    next(err)
  }
})

// POST /api/documents/:roomCode/versions — capture a version now (editor+)
documentsRouter.post('/:roomCode/versions', requireEditor, async (req, res, next) => {
  try {
    const doc = await getDocumentByRoomCode(req.params.roomCode)
    if (!doc) throw new HttpError(404, 'Document not found')
    const version = await createVersion(doc.id, doc.content, req.auth?.userId ?? null)
    res.status(201).json({ version })
  } catch (err) {
    next(err)
  }
})

// POST /api/documents/:roomCode/versions/:id/restore — restore a version (editor+)
documentsRouter.post('/:roomCode/versions/:id/restore', requireEditor, async (req, res, next) => {
  try {
    await restoreVersion(req.params.id, req.auth?.userId ?? null)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// GET /api/documents/:roomCode/snapshots — named snapshots
documentsRouter.get('/:roomCode/snapshots', async (req, res, next) => {
  try {
    res.json({ snapshots: await listSnapshots(req.params.roomCode) })
  } catch (err) {
    next(err)
  }
})

// POST /api/documents/:roomCode/snapshots — create a named snapshot (editor+)
documentsRouter.post('/:roomCode/snapshots', requireEditor, async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body)
    const snapshot = await createSnapshot(req.params.roomCode, body.name, req.auth?.userId ?? null)
    res.status(201).json({ snapshot })
  } catch (err) {
    next(err)
  }
})

// POST /api/documents/:roomCode/snapshots/:id/restore — restore a snapshot (editor+)
documentsRouter.post('/:roomCode/snapshots/:id/restore', requireEditor, async (req, res, next) => {
  try {
    await restoreSnapshot(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/documents/:roomCode/snapshots/:id — delete a snapshot (editor+)
documentsRouter.delete('/:roomCode/snapshots/:id', requireEditor, async (req, res, next) => {
  try {
    await deleteSnapshot(req.params.id)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})
