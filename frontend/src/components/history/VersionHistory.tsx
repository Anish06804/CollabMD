import { useEffect, useState } from 'react'
import { History, RotateCcw, Camera, Trash2 } from 'lucide-react'
import type { PublicSnapshot, PublicVersion } from '../../types'
import { api } from '../../lib/api'
import { formatTime } from '../../lib/utils'
import { toastSuccess, toastError } from '../ui/Toaster'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'

interface VersionHistoryProps {
  roomCode: string
  canEdit: boolean
  onChanged: () => void
}

export function VersionHistory({ roomCode, canEdit, onChanged }: VersionHistoryProps) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'versions' | 'snapshots'>('versions')
  const [versions, setVersions] = useState<PublicVersion[]>([])
  const [snapshots, setSnapshots] = useState<PublicSnapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [snapshotName, setSnapshotName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [v, s] = await Promise.all([api.listVersions(roomCode), api.listSnapshots(roomCode)])
      setVersions(v.versions)
      setSnapshots(s.snapshots)
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const restoreVersion = async (id: string) => {
    setBusy(true)
    try {
      await api.restoreVersion(roomCode, id)
      toastSuccess('Version restored')
      onChanged()
      load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setBusy(false)
    }
  }

  const createSnapshot = async () => {
    if (!snapshotName.trim()) return
    setBusy(true)
    try {
      await api.createSnapshot(roomCode, snapshotName.trim())
      toastSuccess('Snapshot saved')
      setSnapshotName('')
      load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Snapshot failed')
    } finally {
      setBusy(false)
    }
  }

  const restoreSnapshot = async (id: string) => {
    setBusy(true)
    try {
      await api.restoreSnapshot(roomCode, id)
      toastSuccess('Snapshot restored')
      onChanged()
      load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Restore failed')
    } finally {
      setBusy(false)
    }
  }

  const deleteSnapshot = async (id: string) => {
    setBusy(true)
    try {
      await api.deleteSnapshot(roomCode, id)
      toastSuccess('Snapshot deleted')
      load()
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <History size={15} />
        History
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Version History & Snapshots" wide>
        <div className="mb-4 flex gap-1 rounded-lg bg-slate-800/60 p-1">
          {(['versions', 'snapshots'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                tab === t ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t === 'versions' ? `Versions (${versions.length})` : `Snapshots (${snapshots.length})`}
            </button>
          ))}
        </div>

        {tab === 'versions' ? (
          <div className="max-h-80 overflow-y-auto">
            {loading && <p className="py-8 text-center text-sm text-slate-500">Loading…</p>}
            {!loading && versions.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-500">
                No versions yet. Versions are captured automatically as you edit.
              </p>
            )}
            {versions.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between rounded-lg border border-slate-700/40 bg-slate-800/40 px-4 py-3 mb-2"
              >
                <div>
                  <div className="text-sm font-medium text-white">v{v.versionNumber}</div>
                  <div className="text-xs text-slate-400">
                    {v.createdBy ? v.createdBy.name : 'Auto-captured'} · {formatTime(v.createdAt)}
                  </div>
                </div>
                {canEdit && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => restoreVersion(v.id)}>
                    <RotateCcw size={14} />
                    Restore
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div>
            {canEdit && (
              <div className="mb-4 flex gap-2">
                <Input
                  placeholder="Snapshot name (e.g. 'Before refactor')"
                  value={snapshotName}
                  onChange={(e) => setSnapshotName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createSnapshot()}
                />
                <Button variant="secondary" size="md" disabled={busy || !snapshotName.trim()} onClick={createSnapshot}>
                  <Camera size={15} />
                  Save
                </Button>
              </div>
            )}
            <div className="max-h-80 overflow-y-auto">
              {loading && <p className="py-8 text-center text-sm text-slate-500">Loading…</p>}
              {!loading && snapshots.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-500">
                  No snapshots yet. Save a named snapshot to mark a point in time.
                </p>
              )}
              {snapshots.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-lg border border-slate-700/40 bg-slate-800/40 px-4 py-3 mb-2"
                >
                  <div>
                    <div className="text-sm font-medium text-white">{s.name}</div>
                    <div className="text-xs text-slate-400">
                      {s.createdBy ? s.createdBy.name : 'You'} · {formatTime(s.createdAt)}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => restoreSnapshot(s.id)}>
                        <RotateCcw size={14} />
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => deleteSnapshot(s.id)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
