import type { Request, Response, NextFunction } from 'express'
import { prisma } from '../db.js'
import { HttpError, type AuthContext, type Permission } from '../types.js'

function extractToken(req: Request): string {
  const fromQuery = req.query.token
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery
  const fromBody = (req.body as { token?: unknown } | undefined)?.token
  if (typeof fromBody === 'string' && fromBody) return fromBody
  const fromHeader = req.headers['x-collabmd-token']
  if (typeof fromHeader === 'string' && fromHeader) return fromHeader
  return ''
}

/** Load the anonymous user identified by the token. */
export async function requireUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractToken(req)
    if (!token) throw new HttpError(401, 'Missing authentication token')
    const user = await prisma.user.findUnique({ where: { token } })
    if (!user) throw new HttpError(401, 'Invalid token — please join the room again')
    ;(req as Request & { authUser?: unknown }).authUser = user
    next()
  } catch (err) {
    next(err)
  }
}

/** Extract the room code from the request path (works in router-level middleware). */
function extractRoomCode(req: Request): string {
  const segments = req.path.split('/').filter(Boolean)
  return (segments[0] || '').toUpperCase()
}

/** Load the caller's membership + permission for :roomCode. */
export async function requireMember(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = (req as Request & { authUser?: { id: string } }).authUser
    if (!user) throw new HttpError(401, 'Not authenticated')
    const roomCode = extractRoomCode(req)
    const membership = await prisma.roomMember.findFirst({
      where: { userId: user.id, room: { roomCode } },
      include: { room: true },
    })
    if (!membership) throw new HttpError(403, 'You are not a member of this room')
    const auth: AuthContext = {
      userId: user.id,
      token: extractToken(req),
      name: '',
      color: null,
      permission: membership.permission,
      isOwner: membership.room.ownerId === user.id,
      locked: membership.room.locked,
    }
    ;(req as Request & { auth?: AuthContext }).auth = auth
    next()
  } catch (err) {
    next(err)
  }
}

/** Require at least EDITOR permission (blocks VIEWER). */
export function requireEditor(req: Request, _res: Response, next: NextFunction) {
  const auth = (req as Request & { auth?: AuthContext }).auth
  if (!auth) return next(new HttpError(401, 'Not authenticated'))
  if (auth.permission === 'VIEWER') {
    return next(new HttpError(403, 'You have read-only access to this room'))
  }
  // Viewing-mode lock: the host may keep editing, everyone else is read-only.
  if (auth.locked && !auth.isOwner) {
    return next(new HttpError(403, 'The host has locked this room to viewing mode'))
  }
  next()
}

/** Require the room OWNER. */
export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  const auth = (req as Request & { auth?: AuthContext }).auth
  if (!auth) return next(new HttpError(401, 'Not authenticated'))
  if (!auth.isOwner) return next(new HttpError(403, 'Only the room owner can do this'))
  next()
}

export function getPermission(req: Request): Permission {
  return (req as Request & { auth?: AuthContext }).auth?.permission ?? 'VIEWER'
}
