import { useState } from 'react'
import { Download, FileText, FileCode, FileType } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'
import { downloadFile } from '../../lib/api'
import { toastSuccess, toastError } from '../ui/Toaster'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  roomCode: string
  roomName: string
}

type ExportKind = 'markdown' | 'html' | 'pdf'

const options: { kind: ExportKind; label: string; desc: string; icon: typeof FileText }[] = [
  { kind: 'markdown', label: 'Markdown', desc: 'Raw .md file', icon: FileText },
  { kind: 'html', label: 'HTML', desc: 'Self-contained page with rendered diagrams', icon: FileCode },
  { kind: 'pdf', label: 'PDF', desc: 'Print-ready document', icon: FileType },
]

export function ExportDialog({ open, onClose, roomCode, roomName }: ExportDialogProps) {
  const [busy, setBusy] = useState<ExportKind | null>(null)

  const doExport = async (kind: ExportKind) => {
    setBusy(kind)
    try {
      const base = roomName.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'document'
      if (kind === 'markdown') {
        await downloadFile(`/api/documents/${roomCode}/export/markdown`, `${base}.md`)
      } else if (kind === 'html') {
        await downloadFile(`/api/documents/${roomCode}/export/html`, `${base}.html`)
      } else {
        await downloadFile(`/api/documents/${roomCode}/export/pdf`, `${base}.pdf`)
      }
      toastSuccess(`${kind.toUpperCase()} exported`)
      onClose()
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Export Document">
      <p className="mb-4 text-sm text-slate-400">
        Download <span className="font-medium text-white">{roomName}</span> in your preferred format.
      </p>
      <div className="flex flex-col gap-2">
        {options.map(({ kind, label, desc, icon: Icon }) => (
          <button
            key={kind}
            onClick={() => doExport(kind)}
            disabled={busy !== null}
            className="flex items-center gap-4 rounded-xl border border-slate-700/50 bg-slate-800/40 px-4 py-3.5 text-left transition-colors hover:border-blue-500/50 hover:bg-slate-800/80 disabled:opacity-50 cursor-pointer"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-700/60">
              {busy === kind ? <Spinner className="h-5 w-5 text-blue-400" /> : <Icon size={20} className="text-blue-400" />}
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-white">{label}</div>
              <div className="text-xs text-slate-400">{desc}</div>
            </div>
            <Download size={16} className="text-slate-500" />
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        HTML and PDF exports include rendered Mermaid diagrams. PDF uses headless Chrome.
      </p>
    </Modal>
  )
}
