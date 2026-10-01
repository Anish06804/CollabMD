import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

export interface CollabSession {
  doc: Y.Doc
  provider: WebsocketProvider
  ytext: Y.Text
  destroy: () => void
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

/**
 * Create a Yjs document + WebSocket provider for a room.
 * The provider handles reconnection with exponential backoff automatically.
 */
export function createCollabSession(roomCode: string, token: string): CollabSession {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(wsUrl(), roomCode, doc, {
    params: { token },
    resyncInterval: 10_000,
    maxBackoffTime: 10_000,
    connect: true,
  })
  const ytext = doc.getText('markdown')

  return {
    doc,
    provider,
    ytext,
    destroy: () => {
      provider.destroy()
      doc.destroy()
    },
  }
}
