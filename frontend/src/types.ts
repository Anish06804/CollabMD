export type Permission = 'OWNER' | 'EDITOR' | 'VIEWER'
export type RoomAccess = 'edit' | 'view'

export interface PublicUser {
  id: string
  token: string
  name: string
  color: string | null
}

export interface PublicMember {
  id: string
  permission: Permission
  joinedAt: string
  user: PublicUser
}

export interface PublicRoom {
  id: string
  roomCode: string
  name: string
  defaultPermission: RoomAccess
  ownerId: string
  /** Host viewing-mode lock: true = everyone except the owner is read-only. */
  locked: boolean
  createdAt: string
  updatedAt: string
}

export interface PublicDocument {
  id: string
  roomId: string
  content: string
  version: number
  updatedAt: string
}

export interface PublicVersion {
  id: string
  versionNumber: number
  createdBy: { id: string; name: string; color: string | null } | null
  createdAt: string
}

export interface PublicSnapshot {
  id: string
  name: string
  createdBy: { id: string; name: string; color: string | null } | null
  createdAt: string
}

export interface JoinResponse {
  user: PublicUser
  room: PublicRoom
  members: PublicMember[]
  permission: Permission
  document: PublicDocument
}

export interface CreateResponse {
  user: PublicUser
  room: PublicRoom
  members: PublicMember[]
  document: PublicDocument
}

export interface Peer {
  clientId: number
  user: { id?: string; name: string; color: string }
  cursor: { anchor: unknown; head: unknown } | null
}
