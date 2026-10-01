import type {
  CreateResponse,
  JoinResponse,
  PublicDocument,
  PublicMember,
  PublicRoom,
  PublicSnapshot,
  PublicVersion,
  RoomAccess,
} from '../types'

const TOKEN_KEY = 'collabmd_token'
const NAME_KEY = 'collabmd_name'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredName(): string {
  return localStorage.getItem(NAME_KEY) || ''
}

export function saveIdentity(token: string, name: string) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(NAME_KEY, name)
}

export function clearIdentity() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(NAME_KEY)
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }
  if (token && !headers['X-Collabmd-Token']) {
    headers['X-Collabmd-Token'] = token
  }
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  const sep = url.includes('?') ? '&' : '?'
  const finalUrl = token && !url.includes('token=') && !options.body ? `${url}${sep}token=${token}` : url

  const res = await fetch(finalUrl, { ...options, headers })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {
      // ignore parse errors
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  createRoom: (input: { name: string; displayName: string; access: RoomAccess; token?: string }) =>
    request<CreateResponse>('/api/rooms', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  joinRoom: (input: { roomCode: string; displayName: string; token?: string }) =>
    request<JoinResponse>('/api/rooms/join', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getRoom: (roomCode: string) =>
    request<{ room: PublicRoom; members: PublicMember[] }>(`/api/rooms/${roomCode}`),

  updateRoom: (roomCode: string, data: { name?: string; access?: RoomAccess; locked?: boolean }) =>
    request<{ room: PublicRoom }>(`/api/rooms/${roomCode}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  setMemberPermission: (roomCode: string, userId: string, permission: string) =>
    request<{ member: PublicMember }>(`/api/rooms/${roomCode}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ permission }),
    }),

  removeMember: (roomCode: string, userId: string) =>
    request<void>(`/api/rooms/${roomCode}/members/${userId}`, { method: 'DELETE' }),

  getDocument: (roomCode: string) =>
    request<{ document: PublicDocument }>(`/api/documents/${roomCode}`),

  listVersions: (roomCode: string) =>
    request<{ versions: PublicVersion[] }>(`/api/documents/${roomCode}/versions`),

  createVersion: (roomCode: string) =>
    request<{ version: PublicVersion }>(`/api/documents/${roomCode}/versions`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  restoreVersion: (roomCode: string, versionId: string) =>
    request<{ ok: true }>(`/api/documents/${roomCode}/versions/${versionId}/restore`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  listSnapshots: (roomCode: string) =>
    request<{ snapshots: PublicSnapshot[] }>(`/api/documents/${roomCode}/snapshots`),

  createSnapshot: (roomCode: string, name: string) =>
    request<{ snapshot: PublicSnapshot }>(`/api/documents/${roomCode}/snapshots`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  restoreSnapshot: (roomCode: string, snapshotId: string) =>
    request<{ ok: true }>(`/api/documents/${roomCode}/snapshots/${snapshotId}/restore`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  deleteSnapshot: (roomCode: string, snapshotId: string) =>
    request<void>(`/api/documents/${roomCode}/snapshots/${snapshotId}`, { method: 'DELETE' }),

  executeCode: (code: string, language: string) =>
    request<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }>(
      '/api/execute',
      { method: 'POST', body: JSON.stringify({ code, language }) },
    ),

  getSupportedLanguages: () =>
    request<{ languages: string[] }>('/api/execute/languages'),

  /** Full language library: every known language + whether it can run here. */
  getLanguageLibrary: () =>
    request<{ languages: string[]; library: PublicLanguage[] }>('/api/execute/languages'),

  /** Server-side language recognition for a code snippet. */
  detectLanguage: (code: string, hint?: string) =>
    request<DetectionResult>('/api/execute/detect', {
      method: 'POST',
      body: JSON.stringify({ code, hint }),
    }),

  /** Which Mermaid generation engine is active (local parser or LLM). */
  getAiEngines: () =>
    request<{ engine: 'local' | 'llm'; model?: string; configured: boolean }>(
      '/api/ai/mermaid/engines',
    ),

  /** Generate Mermaid source from a natural-language description. */
  generateMermaid: (input: { prompt: string; type?: string; context?: string }) =>
    request<MermaidGeneration>('/api/ai/mermaid', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Structural lint of existing Mermaid source. */
  validateMermaid: (code: string) =>
    request<{ valid: boolean; errors: string[] }>('/api/ai/mermaid/validate', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
}

export interface PublicLanguage {
  id: string
  label: string
  color: string
  ext: string
  aliases: string[]
  category: string
  runnable: boolean
  version?: string
}

export interface DetectionCandidate {
  id: string
  label: string
  color: string
  confidence: number
}

export interface DetectionResult {
  language: DetectionCandidate | null
  candidates: DetectionCandidate[]
  uncertain: boolean
}

export interface MermaidGeneration {
  code: string
  diagramType: string
  engine: 'local' | 'llm'
  model?: string
  summary: string
  stats: { nodes: number; edges: number; other?: number }
  warnings: string[]
}

export async function downloadFile(url: string, filename: string) {
  const token = getToken()
  const sep = url.includes('?') ? '&' : '?'
  const res = await fetch(token ? `${url}${sep}token=${token}` : url)
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}
