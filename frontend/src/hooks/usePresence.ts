import { useEffect, useState } from 'react'
import type { Awareness } from 'y-protocols/awareness'
import type { Peer } from '../types'

interface AwarenessUser {
  id?: string
  name: string
  color: string
}

interface AwarenessState {
  user?: AwarenessUser
  cursor?: { anchor: unknown; head: unknown } | null
}

/**
 * Tracks remote collaborators (presence + cursors) from a Yjs Awareness instance.
 */
export function usePresence(awareness: Awareness | null, selfClientId: number | null): Peer[] {
  const [peers, setPeers] = useState<Peer[]>([])

  useEffect(() => {
    if (!awareness) {
      setPeers([])
      return
    }

    const update = () => {
      const list: Peer[] = []
      for (const [clientId, state] of awareness.getStates() as Map<number, AwarenessState>) {
        if (clientId === awareness.clientID) continue
        if (!state?.user) continue
        list.push({
          clientId,
          user: state.user as AwarenessUser,
          cursor: state.cursor ?? null,
        })
      }
      setPeers(list)
    }

    update()
    awareness.on('change', update)
    return () => {
      awareness.off('change', update)
    }
  }, [awareness, selfClientId])

  return peers
}
