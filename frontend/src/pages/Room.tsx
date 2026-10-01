import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Share2, Download, Users, Play, Code2, Wand2, Lock, Unlock } from 'lucide-react'
import { Logo } from '../components/ui/Logo'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { MarkdownEditor } from '../components/editor/MarkdownEditor'
import { MarkdownPreview } from '../components/preview/MarkdownPreview'
import { CodeExecutor } from '../components/editor/CodeExecutor'
import { LanguageSelector } from '../components/editor/LanguageSelector'
import { MermaidStudio } from '../components/ai/MermaidStudio'
import { PresenceBar } from '../components/collaboration/PresenceBar'
import { ConnectionBadge } from '../components/collaboration/ConnectionBadge'
import { VersionHistory } from '../components/history/VersionHistory'
import { ExportDialog } from '../components/export/ExportDialog'
import { ShareDialog } from '../components/share/ShareDialog'
import { useCollaboration } from '../hooks/useCollaboration'
import { usePresence } from '../hooks/usePresence'
import { useDocument } from '../hooks/useDocument'
import { api, getToken, getStoredName, saveIdentity } from '../lib/api'
import { toastError, toastSuccess } from '../components/ui/Toaster'
import { extractCodeBlocks, findRunnableBlock, isExecutable } from '../lib/codeBlocks'
import { detectLanguage } from '../lib/languageDetect'
import { loadLanguageLibrary, findLanguage } from '../lib/languageLibrary'
import type { JoinResponse, PublicMember, RoomAccess } from '../types'
import { cn } from '../lib/utils'

type Phase = 'loading' | 'join' | 'ready' | 'error'

export default function Room() {
  const { roomCode = '' } = useParams()
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [data, setData] = useState<JoinResponse | null>(null)
  const [members, setMembers] = useState<PublicMember[]>([])
  const [access, setAccess] = useState<RoomAccess>('edit')
  const [joinName, setJoinName] = useState(getStoredName())
  const [shareOpen, setShareOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [lastSaved, setLastSaved] = useState<'saved' | 'saving'>('saved')
  const [refreshKey, setRefreshKey] = useState(0)
  // Viewing-mode lock (host toggle) — live value mirrored through the shared doc
  const [metaLocked, setMetaLocked] = useState<boolean | null>(null)
  const [lockBusy, setLockBusy] = useState(false)

  // Code execution state
  const [selectedLanguage, setSelectedLanguage] = useState('javascript')
  // When the user picks a language from the dropdown, it overrides block detection
  const [languageOverride, setLanguageOverride] = useState<string | null>(null)
  const [runCode, setRunCode] = useState<{ id: number; code: string; language: string } | null>(null)
  // Editor cursor position — drives run-block picking + status-bar detection
  const [cursorPos, setCursorPos] = useState(0)

  const token = getToken()
  const { session, status } = useCollaboration(roomCode, phase === 'ready' ? token : null)
  const { content } = useDocument(session?.ytext ?? null)
  const peers = usePresence(session?.provider.awareness ?? null, null)

  // ---- Viewing-mode lock: observe the server-written roomMeta flag ----
  // The host's toggle is mirrored into the shared Yjs doc by the server, so
  // every connected client flips mode instantly — no polling, no reload.
  useEffect(() => {
    if (!session) return
    const meta = session.doc.getMap<boolean>('roomMeta')
    const sync = () => setMetaLocked(meta.has('locked') ? meta.get('locked') === true : null)
    sync()
    meta.observe(sync)
    return () => meta.unobserve(sync)
  }, [session])

  // Permissions (plain values — safe to use in callbacks defined below)
  const isOwner = data ? data.members.find((m) => m.user.id === data.user.id)?.permission === 'OWNER' : false
  // Host viewing-mode lock: while locked, every member except the owner can edit.
  const locked = metaLocked ?? data?.room.locked ?? false
  const canEdit = data ? data.permission !== 'VIEWER' && (!locked || isOwner) : false

  // ---- Join / load room ----
  // Guards against React StrictMode's double effect — a concurrent duplicate
  // join would race the RoomMember unique constraint (and mint ghost users).
  const loadStartedRef = useRef(false)
  const submitRef = useRef(false)

  const loadRoom = useCallback(async () => {
    if (loadStartedRef.current) return
    const t = getToken()
    if (!t) {
      setPhase('join')
      return
    }
    loadStartedRef.current = true
    try {
      // Send the token so an existing identity is REUSED instead of minting a
      // brand-new guest user on every page load.
      const res = await api.joinRoom({ roomCode, displayName: getStoredName() || 'Anonymous', token: t })
      saveIdentity(res.user.token, res.user.name)
      setData(res)
      setMembers(res.members)
      setAccess(res.room.defaultPermission)
      setPhase('ready')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to join room'
      if (msg.includes('not found') || msg.includes('not a member') || msg.includes('Invalid token')) {
        setError(msg)
        setPhase('join')
      } else {
        setError(msg)
        setPhase('error')
      }
    }
  }, [roomCode])

  useEffect(() => {
    setPhase('loading')
    void loadRoom()
  }, [loadRoom])

  // ---- Join gate submit ----
  const handleJoin = async () => {
    if (!joinName.trim() || submitRef.current) return
    submitRef.current = true
    try {
      const res = await api.joinRoom({
        roomCode,
        displayName: joinName.trim(),
        token: getToken() || undefined,
      })
      saveIdentity(res.user.token, res.user.name)
      setData(res)
      setMembers(res.members)
      setAccess(res.room.defaultPermission)
      setPhase('ready')
      toastSuccess(`Welcome, ${res.user.name}!`)
    } catch (err) {
      submitRef.current = false
      toastError(err instanceof Error ? err.message : 'Failed to join')
    }
  }

  // ---- Presence: broadcast our user info ----
  useEffect(() => {
    if (!session || !data) return
    session.provider.awareness.setLocalStateField('user', {
      // `id` lets presence match members by identity, not display name —
      // two people named "Bob" would otherwise both show as online.
      id: data.user.id,
      name: data.user.name,
      color: data.user.color || '#6b7280',
    })
  }, [session, data])

  // ---- Save indicator ----
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (phase !== 'ready') return
    setLastSaved('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => setLastSaved('saved'), 1200)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [content, phase])

  // ---- Periodic member refresh ----
  useEffect(() => {
    if (phase !== 'ready') return
    const interval = setInterval(async () => {
      try {
        const res = await api.getRoom(roomCode)
        setMembers(res.members)
        setAccess(res.room.defaultPermission)
      } catch {
        // ignore transient errors
      }
    }, 15_000)
    return () => clearInterval(interval)
  }, [phase, roomCode])

  const refreshMembers = useCallback(async () => {
    try {
      const res = await api.getRoom(roomCode)
      setMembers(res.members)
      setAccess(res.room.defaultPermission)
    } catch {
      // ignore
    }
  }, [roomCode])

  // ---- Host toggle: switch the room between editing and viewing mode ----
  const toggleLock = useCallback(async () => {
    if (!isOwner || lockBusy) return
    const next = !locked
    setLockBusy(true)
    try {
      await api.updateRoom(roomCode, { locked: next })
      setMetaLocked(next) // optimistic — the server's roomMeta broadcast confirms
      toastSuccess(
        next
          ? 'Viewing mode on — everyone except you is now read-only'
          : 'Editing unlocked for everyone',
      )
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to change mode')
    } finally {
      setLockBusy(false)
    }
  }, [isOwner, locked, lockBusy, roomCode])

  // ---- Load the probed language library once (drives Run badges + detection) ----
  useEffect(() => {
    void loadLanguageLibrary()
  }, [])

  // ---- Code execution ----
  const handleRunCode = useCallback(() => {
    if (!content) return
    const blocks = extractCodeBlocks(content)
    if (blocks.length === 0) {
      toastError('No code blocks found — add one like ```javascript ... ```')
      return
    }
    // Prefer the runnable block containing the cursor; else nearest runnable block
    const target = findRunnableBlock(blocks, cursorPos)
    if (!target) {
      toastError('No runnable code block found. Add a block tagged with a runnable language.')
      return
    }
    // User's dropdown choice wins over the fence tag; otherwise use the block's language
    let lang = languageOverride ?? target.language

    // Untagged block → recognize the language and write the fence tag into the
    // shared document (a real, conflict-free Yjs insert the whole room sees).
    if (!lang) {
      const det = detectLanguage(target.code)
      if (!det.language || det.uncertain) {
        toastError('Could not recognize this block — pick a language from the selector first.')
        return
      }
      lang = det.language.id
      if (canEdit && session) {
        // target.start points at the opening ``` — insert the tag right after it
        session.ytext.insert(target.start + 3, ` ${lang}`)
      }
      toastSuccess(`Detected ${det.language.label} — tagged the block`)
    }

    if (!isExecutable(lang)) {
      toastError(`"${lang}" can't be executed on this server. Check the selector's "run" badge.`)
      return
    }
    setSelectedLanguage(lang)
    setRunCode({ id: Date.now(), code: target.code, language: lang })
  }, [content, languageOverride, cursorPos, canEdit, session])

  // Listen for Ctrl+Enter from the editor
  useEffect(() => {
    const handler = () => handleRunCode()
    window.addEventListener('collabmd:run-code', handler)
    return () => window.removeEventListener('collabmd:run-code', handler)
  }, [handleRunCode])

  // ---- Insert a generated Mermaid block at the cursor ----
  const insertMermaid = useCallback(
    (code: string) => {
      if (!session || !canEdit) return
      const ytext = session.ytext
      // Y.Text.toString() has no range args — snapshot the doc once.
      const text = ytext.toString()
      const len = text.length
      const at = Math.max(0, Math.min(cursorPos, len))
      const before = at > 0 ? text[at - 1] : '\n'
      const after = at < len ? text[at] : '\n'
      const prefix = before !== '\n' ? '\n' : ''
      const suffix = after !== '\n' ? '\n' : ''
      ytext.insert(at, `${prefix}\`\`\`mermaid\n${code}\n\`\`\`\n${suffix}`)
      setCursorPos(at + prefix.length + `\`\`\`mermaid\n`.length + code.length)
    },
    [session, canEdit, cursorPos],
  )

  // ---- Language under the cursor (status bar) ----
  const detection = (() => {
    const blocks = extractCodeBlocks(content)
    const block = blocks.find((b) => cursorPos >= b.start && cursorPos <= b.end)
    if (!block) return { id: 'markdown', label: 'Markdown', color: '#083fa1', confidence: 1, tagged: true }
    if (block.language) {
      const lib = findLanguage(block.language)
      return {
        id: lib?.id ?? block.language,
        label: lib?.label ?? block.language,
        color: lib?.color ?? '#64748b',
        confidence: 1,
        tagged: true,
      }
    }
    const det = detectLanguage(block.code)
    if (det.language) return { ...det.language, tagged: false }
    return { id: 'plaintext', label: 'Plain Text', color: '#64748b', confidence: 0, tagged: false }
  })()

  // ---- Loading ----
  if (phase === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0b0d12]">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-blue-500" />
          <p className="text-sm text-slate-400">Loading workspace…</p>
        </div>
      </div>
    )
  }

  // ---- Error ----
  if (phase === 'error') {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0b0d12]">
        <div className="text-center">
          <p className="mb-2 text-lg font-semibold text-white">Something went wrong</p>
          <p className="text-sm text-slate-400">{error}</p>
        </div>
      </div>
    )
  }

  // ---- Join gate ----
  if (phase === 'join') {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0b0d12] p-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl">
          <Logo size="sm" />
          <h1 className="mt-6 mb-1 text-xl font-bold text-white">Join workspace</h1>
          <p className="mb-6 text-sm text-slate-400">
            Room <span className="font-mono font-semibold text-blue-400">{roomCode}</span>
          </p>
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <Input
              label="Your display name"
              placeholder="e.g. Alice"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              autoFocus
            />
            <Button className="w-full" size="lg" disabled={!joinName.trim()} onClick={handleJoin}>
              Join Workspace
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ---- Workspace ----
  return (
    <div className="flex h-screen flex-col bg-[#0b0d12]">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-slate-800/60 bg-slate-900/50 px-4 py-2.5">
        <div className="flex items-center gap-4">
          <Logo size="sm" />
          <div className="h-5 w-px bg-slate-700/60" />
          <div>
            <h1 className="text-sm font-semibold text-white leading-tight">{data?.room.name}</h1>
            <p className="text-[11px] text-slate-500 font-mono">/{roomCode}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <PresenceBar peers={peers} members={members} selfUserId={data?.user.id ?? ''} />
          <div className="h-5 w-px bg-slate-700/60" />
          <ConnectionBadge status={status} />
          {isOwner && (
            <Button
              variant="secondary"
              size="sm"
              className={cn(locked && 'border-amber-500/60 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20')}
              onClick={() => void toggleLock()}
              disabled={lockBusy}
              title={
                locked
                  ? 'Viewing mode is on — click to unlock editing for everyone'
                  : 'Switch the room to viewing mode — everyone except you becomes read-only'
              }
            >
              {locked ? <Lock size={15} /> : <Unlock size={15} />}
              {locked ? 'Viewing mode' : 'Editing mode'}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setShareOpen(true)}>
            <Share2 size={15} />
            Share
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setExportOpen(true)}>
            <Download size={15} />
            Export
          </Button>
          <VersionHistory roomCode={roomCode} canEdit={canEdit} onChanged={() => setRefreshKey((k) => k + 1)} />
        </div>
      </header>

      {/* Toolbar: Language selector + Run button */}
      <div className="flex items-center justify-between border-b border-slate-800/40 bg-slate-900/30 px-4 py-1.5">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setStudioOpen(true)} title="Describe a diagram in plain text and get live Mermaid">
            <Wand2 size={13} />
            Diagram Studio
          </Button>
          <div className="h-4 w-px bg-slate-700/60" />
          <Code2 size={14} className="text-slate-500" />
          <LanguageSelector
            value={selectedLanguage}
            onChange={(lang) => {
              setLanguageOverride(lang)
              setSelectedLanguage(lang)
            }}
            disabled={!canEdit}
          />
        </div>
        <Button variant="ghost" size="sm" onClick={handleRunCode} disabled={!canEdit}>
          <Play size={13} />
          Run Code
          <kbd className="ml-1.5 rounded bg-slate-700/60 px-1 py-0.5 text-[10px] text-slate-400">Ctrl+Enter</kbd>
        </Button>
      </div>

      {/* Viewing-mode banner (host lock) */}
      {locked && (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-300">
          <Lock size={12} className="shrink-0" />
          {isOwner
            ? 'Viewing mode is ON — you (the host) can still edit; every other member is read-only until you unlock.'
            : 'Viewing mode — the host has locked editing. You can read, export and copy, but not change the document.'}
        </div>
      )}

      {/* Main panes */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor */}
        <div className="flex w-1/2 flex-col border-r border-slate-800/60">
          <div className="flex items-center justify-between border-b border-slate-800/40 bg-slate-900/30 px-4 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Markdown
            </span>
            {!canEdit && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                {locked && !isOwner ? 'View only · locked' : 'Read only'}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            {session && (
              <MarkdownEditor
                ytext={session.ytext}
                awareness={session.provider.awareness}
                readOnly={!canEdit}
                onCursorChange={(pos) => setCursorPos(pos)}
              />
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="flex w-1/2 flex-col">
          <div className="flex items-center justify-between border-b border-slate-800/40 bg-slate-900/30 px-4 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Live Preview
            </span>
            <span className="text-[11px] text-slate-600">Auto-updates as you type</span>
          </div>
          <div className="flex-1 overflow-hidden bg-[#0e1118]">
            <MarkdownPreview content={content} />
          </div>
        </div>
      </div>

      {/* Code Output Panel */}
      {runCode && (
        <CodeExecutor
          key={runCode.id}
          code={runCode.code}
          language={runCode.language}
          canEdit={canEdit}
        />
      )}

      {/* Status bar */}
      <footer className="flex items-center justify-between border-t border-slate-800/60 bg-slate-900/50 px-4 py-1.5">
        <div className="flex items-center gap-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400' : 'bg-red-400',
              )}
            />
            {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting' : 'Reconnecting'}
          </span>
          <span className="flex items-center gap-1.5">
            <Users size={12} />
            {peers.length + 1} online
          </span>
          <span
            className="flex items-center gap-1.5 rounded border border-slate-700/50 px-1.5 py-0.5"
            title={detection.tagged ? 'Fence-tagged language' : 'Recognized from code content'}
          >
            <span className="h-2 w-2 rounded-sm" style={{ background: detection.color }} />
            <span className="text-slate-400">{detection.label}</span>
            {!detection.tagged && detection.confidence > 0 && (
              <span className="text-amber-500/80">
                detected {Math.round(detection.confidence * 100)}%
              </span>
            )}
          </span>
          {locked && (
            <span
              className="flex items-center gap-1.5 rounded border border-amber-500/40 px-1.5 py-0.5 text-amber-400"
              title="Host viewing-mode lock"
            >
              <Lock size={11} />
              Viewing mode
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-[11px] text-slate-500">
          <span className={cn(lastSaved === 'saved' ? 'text-emerald-500' : 'text-amber-500')}>
            {lastSaved === 'saved' ? '● Saved' : '● Saving…'}
          </span>
          <span>v{data?.document.version ?? 0}</span>
        </div>
      </footer>

      {/* Dialogs */}
      {data && (
        <ShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          roomCode={roomCode}
          roomName={data.room.name}
          access={access}
          members={members}
          isOwner={isOwner}
          selfUserId={data.user.id}
          onAccessChange={setAccess}
          onMembersChanged={refreshMembers}
        />
      )}
      {data && (
        <ExportDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          roomCode={roomCode}
          roomName={data.room.name}
        />
      )}
      <MermaidStudio
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        onInsert={insertMermaid}
        documentContext={content}
        canInsert={canEdit}
      />
    </div>
  )
}
