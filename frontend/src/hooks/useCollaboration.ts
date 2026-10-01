import { useEffect, useState } from 'react'
import { createCollabSession, type CollabSession } from '../lib/collab'

export type ConnStatus = 'connecting' | 'connected' | 'disconnected'

/**
 * Owns the Yjs document + WebSocket provider lifecycle for a room.
 * Exposes the collaborative text, connection status, and a destroy function.
 */
export function useCollaboration(roomCode: string, token: string | null) {
  const [session, setSession] = useState<CollabSession | null>(null)
  const [status, setStatus] = useState<ConnStatus>('connecting')

  useEffect(() => {
    if (!token) return
    const collab = createCollabSession(roomCode, token)
    setSession(collab)
    setStatus('connecting')

    const onStatus = (e: { status: string }) => {
      setStatus(e.status as ConnStatus)
    }
    collab.provider.on('status', onStatus)
    if (collab.provider.wsconnected) setStatus('connected')

    return () => {
      collab.provider.off('status', onStatus)
      collab.destroy()
      setSession(null)
    }
  }, [roomCode, token])

  return { session, status }
}
