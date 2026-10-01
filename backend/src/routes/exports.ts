import { Router } from 'express'
import { requireUser, requireMember } from '../middleware/auth.js'
import { exportMarkdown, exportHtml, exportPdf } from '../services/exportService.js'
import { HttpError } from '../types.js'

export const exportsRouter = Router()

exportsRouter.use(requireUser, requireMember)

function sendBuffer(res: import('express').Response, buffer: Uint8Array, filename: string, type: string) {
  const body = Buffer.from(buffer)
  res.setHeader('Content-Type', type)
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Content-Length', String(body.length))
  res.send(body)
}

function safeFilename(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'document'
}

// GET /api/documents/:roomCode/export/markdown
exportsRouter.get('/:roomCode/export/markdown', async (req, res, next) => {
  try {
    const buffer = await exportMarkdown(req.params.roomCode)
    sendBuffer(res, buffer, 'document.md', 'text/markdown; charset=utf-8')
  } catch (err) {
    next(err)
  }
})

// GET /api/documents/:roomCode/export/html
exportsRouter.get('/:roomCode/export/html', async (req, res, next) => {
  try {
    const buffer = await exportHtml(req.params.roomCode)
    sendBuffer(res, buffer, 'document.html', 'text/html; charset=utf-8')
  } catch (err) {
    next(err)
  }
})

// GET /api/documents/:roomCode/export/pdf
exportsRouter.get('/:roomCode/export/pdf', async (req, res, next) => {
  try {
    const buffer = await exportPdf(req.params.roomCode)
    sendBuffer(res, buffer, 'document.pdf', 'application/pdf')
  } catch (err) {
    if (err instanceof Error && err.message.includes('mermaid')) {
      throw new HttpError(502, 'PDF export failed while rendering diagrams')
    }
    next(err)
  }
})

export { safeFilename }
