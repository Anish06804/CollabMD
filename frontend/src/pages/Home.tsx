import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users,
  GitBranch,
  FileText,
  Download,
  Link2,
  Zap,
  ArrowRight,
  FolderPlus,
  LogIn,
} from 'lucide-react'
import { Logo } from '../components/ui/Logo'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { api, getToken, getStoredName, saveIdentity } from '../lib/api'
import { toastError, toastSuccess } from '../components/ui/Toaster'
import type { RoomAccess } from '../types'

const features = [
  {
    icon: Users,
    title: 'Real-Time Collaboration',
    desc: 'See every keystroke, cursor, and selection live. No refresh, no conflicts — powered by Yjs CRDTs.',
  },
  {
    icon: GitBranch,
    title: 'Live Mermaid Diagrams',
    desc: 'Write ```mermaid blocks and watch architecture diagrams render as you type.',
  },
  {
    icon: FileText,
    title: 'Version History',
    desc: 'Every quiet period is captured automatically. Restore any point in time with one click.',
  },
  {
    icon: Zap,
    title: 'Instant Markdown Preview',
    desc: 'A live preview pane renders your Markdown in real time as fast as you can type.',
  },
  {
    icon: Download,
    title: 'PDF / HTML Export',
    desc: 'Export your document as Markdown, a self-contained HTML page, or a print-ready PDF.',
  },
  {
    icon: Link2,
    title: 'Shareable Rooms',
    desc: 'Create a room, share the link, and invite your team. Granular permissions included.',
  },
]

export default function Home() {
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [displayName, setDisplayName] = useState(getStoredName())
  const [access, setAccess] = useState<RoomAccess>('edit')
  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)

  const createRoom = async () => {
    if (!roomName.trim() || !displayName.trim()) return
    setBusy(true)
    try {
      const res = await api.createRoom({
        name: roomName.trim(),
        displayName: displayName.trim(),
        access,
        token: getToken() ?? undefined,
      })
      saveIdentity(res.user.token, res.user.name)
      toastSuccess(`Room "${res.room.name}" created`)
      navigate(`/room/${res.room.roomCode}`)
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to create room')
    } finally {
      setBusy(false)
    }
  }

  const joinRoom = async () => {
    if (!joinCode.trim() || !displayName.trim()) return
    setBusy(true)
    try {
      const res = await api.joinRoom({
        roomCode: joinCode.trim(),
        displayName: displayName.trim(),
      })
      saveIdentity(res.user.token, res.user.name)
      toastSuccess(`Joined "${res.room.name}"`)
      navigate(`/room/${res.room.roomCode}`)
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to join room')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0d12]">
      {/* Nav */}
      <header className="border-b border-slate-800/60 bg-slate-900/40 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo />
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setJoinOpen(true)}>
              <LogIn size={15} />
              Join Room
            </Button>
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              <FolderPlus size={15} />
              Create Room
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.12),transparent_60%)]" />
        <div className="relative mx-auto max-w-4xl px-6 pt-24 pb-16 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-1.5 text-sm text-blue-300">
            <Zap size={14} />
            Real-time collaborative Markdown & Mermaid studio
          </div>
          <h1 className="mb-6 text-5xl font-extrabold tracking-tight text-white sm:text-6xl">
            Write. Diagram.{' '}
            <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
              Collaborate.
            </span>
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg text-slate-400">
            A real-time collaborative Markdown workspace with live Mermaid diagrams,
            version history, and one-click documentation export.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button size="lg" onClick={() => setCreateOpen(true)}>
              Create Room
              <ArrowRight size={18} />
            </Button>
            <Button size="lg" variant="secondary" onClick={() => setJoinOpen(true)}>
              Join Room
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-slate-800/60 bg-slate-900/40 p-6 transition-all hover:border-slate-700 hover:bg-slate-900/70"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 transition-colors group-hover:bg-blue-500/20">
                <f.icon size={22} />
              </div>
              <h3 className="mb-2 text-base font-semibold text-white">{f.title}</h3>
              <p className="text-sm leading-relaxed text-slate-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/60 py-8 text-center text-sm text-slate-600">
        CollabMD — Built for teams who write together.
      </footer>

      {/* Create Room Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create a new workspace">
        <div className="space-y-4">
          <Input
            label="Workspace name"
            placeholder="e.g. API Documentation"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createRoom()}
            autoFocus
          />
          <Input
            label="Your display name"
            placeholder="e.g. Alice"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createRoom()}
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Access</label>
            <div className="flex gap-2">
              {(['edit', 'view'] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setAccess(a)}
                  className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                    access === a
                      ? 'border-blue-500/60 bg-blue-500/10 text-blue-300'
                      : 'border-slate-700/50 bg-slate-800/40 text-slate-400 hover:text-white'
                  }`}
                >
                  {a === 'edit' ? 'Anyone with link can edit' : 'Anyone with link can view'}
                </button>
              ))}
            </div>
          </div>
          <Button className="w-full" size="lg" disabled={busy || !roomName.trim() || !displayName.trim()} onClick={createRoom}>
            Create Workspace
          </Button>
        </div>
      </Modal>

      {/* Join Room Modal */}
      <Modal open={joinOpen} onClose={() => setJoinOpen(false)} title="Join a workspace">
        <div className="space-y-4">
          <Input
            label="Room code"
            placeholder="e.g. A7K92P"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
            autoFocus
            maxLength={8}
            className="font-mono text-lg tracking-widest uppercase"
          />
          <Input
            label="Your display name"
            placeholder="e.g. Bob"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
          />
          <Button className="w-full" size="lg" disabled={busy || !joinCode.trim() || !displayName.trim()} onClick={joinRoom}>
            Join Workspace
          </Button>
        </div>
      </Modal>
    </div>
  )
}
