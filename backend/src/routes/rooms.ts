import { Router } from 'express'
import { z } from 'zod'
import { createRoom, joinRoom, getRoomByCode, updateRoom, setMemberPermission, removeMember } from '../services/roomService.js'
import { requireUser, requireMember, requireOwner } from '../middleware/auth.js'
import { HttpError, type Permission } from '../types.js'
import { serializeRoom, serializeMember } from '../utils/serialize.js'
import { notifyRoomLockChanged } from '../websocket/collaboration.js'
import { prisma } from '../db.js'

export const roomsRouter = Router()

const accessSchema = z.object({ access: z.enum(['edit', 'view']).default('edit') })

const createSchema = z.object({
  name: z.string().trim().min(1, 'Workspace name is required').max(80),
  displayName: z.string().trim().min(1, 'Display name is required').max(40),
  access: z.enum(['edit', 'view']),
  token: z.string().optional(),
})

const joinSchema = z.object({
  roomCode: z.string().trim().min(4, 'Room code is required').max(12),
  displayName: z.string().trim().min(1, 'Display name is required').max(40),
  token: z.string().optional(),
})

// POST /api/rooms — create a new workspace
roomsRouter.post('/', async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body)
    const result = await createRoom(body)
    res.status(201).json(result)
  } catch (err) {
    next(err)
  }
})

// POST /api/rooms/join — join an existing room (creates identity on first join)
roomsRouter.post('/join', async (req, res, next) => {
  try {
    const body = joinSchema.parse(req.body)
    const result = await joinRoom(body)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// GET /api/rooms/:roomCode — room detail (auth via ?token=)
roomsRouter.get('/:roomCode', requireUser, requireMember, async (req, res, next) => {
  try {
    const room = await getRoomByCode(req.params.roomCode)
    const members = await prisma.roomMember.findMany({
      where: { roomId: room.id },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    })
    res.json({ room: serializeRoom(room), members: members.map(serializeMember) })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/rooms/:roomCode — rename / change link access / toggle viewing
// mode (owner only). `locked` is the host viewing-mode lock: while true every
// member except the owner is read-only (enforced on REST + WebSocket).
roomsRouter.patch('/:roomCode', requireUser, requireMember, requireOwner, async (req, res, next) => {
  try {
    const body = accessSchema.partial().extend({
      name: z.string().trim().min(1).max(80).optional(),
      locked: z.boolean().optional(),
      defaultPermission: z.enum(['edit', 'view']).optional(),
    }).parse(req.body)
    const room = await updateRoom(req.params.roomCode, {
      name: body.name,
      defaultPermission: body.access ?? body.defaultPermission,
      locked: body.locked,
    })
    if (body.locked !== undefined) {
      notifyRoomLockChanged(room.roomCode, body.locked)
    }
    res.json({ room })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/rooms/:roomCode/members/:userId — change a member's permission (owner only)
roomsRouter.patch('/:roomCode/members/:userId', requireUser, requireMember, requireOwner, async (req, res, next) => {
  try {
    const permission = z.enum(['OWNER', 'EDITOR', 'VIEWER']).parse(req.body?.permission) as Permission
    if (permission === 'OWNER') throw new HttpError(400, 'Cannot grant ownership')
    const member = await setMemberPermission(req.params.roomCode, req.params.userId, permission)
    res.json({ member })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/rooms/:roomCode/members/:userId — remove a member (owner only)
roomsRouter.delete('/:roomCode/members/:userId', requireUser, requireMember, requireOwner, async (req, res, next) => {
  try {
    await removeMember(req.params.roomCode, req.params.userId)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})
