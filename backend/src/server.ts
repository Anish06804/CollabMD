import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { config } from './config.js'
import { prisma } from './db.js'
import { roomsRouter } from './routes/rooms.js'
import { documentsRouter } from './routes/documents.js'
import { exportsRouter } from './routes/exports.js'
import { executeRouter } from './routes/execute.js'
import { aiRouter } from './routes/ai.js'
import { handleWebSocketUpgrade } from './websocket/collaboration.js'
import { shutdownAll } from './services/collaborationRegistry.js'
import { ZodError } from 'zod'
import fs from 'node:fs'
import path from 'node:path'

const app = express()

app.use(cors({ origin: config.frontendUrl === '*' ? true : config.frontendUrl.split(',') }))
app.use(express.json({ limit: '1mb' }))

// Favicon 404 ignore handler
app.get('/favicon.ico', (_req, res) => res.status(204).end())

// Health Check API
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() })
})

app.use('/api/rooms', roomsRouter)
app.use('/api/documents', documentsRouter)
app.use('/api/documents', exportsRouter)
app.use('/api/execute', executeRouter)
app.use('/api/ai', aiRouter)

// Serve the built frontend when present (single-server deploys).
const frontendDist = path.join(process.cwd(), '..', 'frontend', 'dist')
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next()
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
} else {
  // Root path handler when frontend is not served from backend (Render API deployment)
  app.get('/', (_req, res) => {
    res.status(200).json({
      status: 'success',
      message: 'CollabMD Backend API + WebSocket Server is running!',
      health: '/api/health'
    })
  })
}

// 404 for unknown API routes
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Central error handler
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: 'Validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
      return
    }
    const status = typeof (err as { status?: number })?.status === 'number' ? (err as { status: number }).status : 500
    const message = err instanceof Error ? err.message : 'Internal server error'
    if (status >= 500) console.error('[api] unhandled error:', err)
    res.status(status).json({ error: message })
  },
)

const server = createServer(app)

// WebSocket endpoint for Yjs synchronization: /ws/:roomCode?token=...
const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '', 'http://localhost')
  if (url.pathname.startsWith('/ws/')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleWebSocketUpgrade(req, ws)
    })
  } else {
    socket.destroy()
  }
})

server.listen(config.port, () => {
  console.log(`[collabmd] API + WebSocket server listening on http://localhost:${config.port}`)
})

async function shutdown(signal: string) {
  console.log(`[collabmd] ${signal} received — flushing documents and shutting down`)
  await shutdownAll()
  await prisma.$disconnect()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
