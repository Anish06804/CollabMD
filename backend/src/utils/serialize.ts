import type { PublicUser, PublicMember, PublicRoom, PublicDocument, PublicVersion, PublicSnapshot } from '../types.js'
import type { User, Room, RoomMember, Document, DocumentVersion, Snapshot } from '@prisma/client'

export function serializeUser(user: User): PublicUser {
  return { id: user.id, token: user.token, name: user.name, color: user.color }
}

export function serializeMember(member: RoomMember & { user: User }): PublicMember {
  return {
    id: member.id,
    permission: member.permission,
    joinedAt: member.joinedAt.toISOString(),
    user: serializeUser(member.user),
  }
}

export function serializeRoom(room: Room): PublicRoom {
  return {
    id: room.id,
    roomCode: room.roomCode,
    name: room.name,
    defaultPermission: room.defaultPermission as PublicRoom['defaultPermission'],
    ownerId: room.ownerId,
    locked: room.locked,
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  }
}

export function serializeDocument(doc: Document): PublicDocument {
  return {
    id: doc.id,
    roomId: doc.roomId,
    content: doc.content,
    version: doc.version,
    updatedAt: doc.updatedAt.toISOString(),
  }
}

export function serializeVersion(v: DocumentVersion & { createdBy: User | null }): PublicVersion {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    createdBy: v.createdBy ? { id: v.createdBy.id, name: v.createdBy.name, color: v.createdBy.color } : null,
    createdAt: v.createdAt.toISOString(),
  }
}

export function serializeSnapshot(s: Snapshot & { createdBy: User | null }): PublicSnapshot {
  return {
    id: s.id,
    name: s.name,
    createdBy: s.createdBy ? { id: s.createdBy.id, name: s.createdBy.name, color: s.createdBy.color } : null,
    createdAt: s.createdAt.toISOString(),
  }
}
