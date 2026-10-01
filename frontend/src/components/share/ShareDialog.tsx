import { useState } from 'react'
import { Copy, Check, Globe, Lock, Trash2 } from 'lucide-react'
import type { PublicMember, RoomAccess } from '../../types'
import { api } from '../../lib/api'
import { copyToClipboard, roomUrl } from '../../lib/utils'
import { toastSuccess, toastError } from '../ui/Toaster'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'

interface ShareDialogProps {
  open: boolean
  onClose: () => void
  roomCode: string
  roomName: string
  access: RoomAccess
  members: PublicMember[]
  isOwner: boolean
  selfUserId: string
  onAccessChange: (access: RoomAccess) => void
  onMembersChanged: () => void
}

export function ShareDialog({
  open,
  onClose,
  roomCode,
  roomName,
  access,
  members,
  isOwner,
  selfUserId,
  onAccessChange,
  onMembersChanged,
}: ShareDialogProps) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const url = roomUrl(roomCode)

  const copy = async () => {
    await copyToClipboard(url)
    setCopied(true)
    toastSuccess('Room link copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }

  const setAccess = async (a: RoomAccess) => {
    setBusy(true)
    try {
      await api.updateRoom(roomCode, { access: a })
      onAccessChange(a)
      toastSuccess(a === 'edit' ? 'Link access: anyone can edit' : 'Link access: view only')
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to update access')
    } finally {
      setBusy(false)
    }
  }

  const setPermission = async (userId: string, permission: string) => {
    setBusy(true)
    try {
      await api.setMemberPermission(roomCode, userId, permission)
      toastSuccess('Permission updated')
      onMembersChanged()
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to update permission')
    } finally {
      setBusy(false)
    }
  }

  const removeMember = async (userId: string) => {
    setBusy(true)
    try {
      await api.removeMember(roomCode, userId)
      toastSuccess('Member removed')
      onMembersChanged()
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to remove member')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Share Workspace" wide>
      <div className="space-y-5">
        {/* Room link */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">Room link</label>
          <div className="flex gap-2">
            <div className="flex-1 rounded-lg border border-slate-600/60 bg-slate-800/80 px-3.5 py-2.5 text-sm text-slate-300 truncate">
              {url}
            </div>
            <Button variant="secondary" onClick={copy}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        {/* Access level */}
        {isOwner && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">Link access</label>
            <div className="flex gap-2">
              {(['edit', 'view'] as const).map((a) => (
                <button
                  key={a}
                  disabled={busy}
                  onClick={() => setAccess(a)}
                  className={cn(
                    'flex flex-1 items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer',
                    access === a
                      ? 'border-blue-500/60 bg-blue-500/10 text-blue-300'
                      : 'border-slate-700/50 bg-slate-800/40 text-slate-400 hover:text-white',
                  )}
                >
                  {a === 'edit' ? <Globe size={15} /> : <Lock size={15} />}
                  {a === 'edit' ? 'Anyone can edit' : 'View only'}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              New people who join with this link will get {access === 'edit' ? 'editor' : 'viewer'} access.
            </p>
          </div>
        )}

        {/* Members */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-300">
            Members ({members.length})
          </label>
          <div className="max-h-56 overflow-y-auto space-y-1.5">
            {members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg border border-slate-700/40 bg-slate-800/40 px-3.5 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: m.user.color || '#6b7280' }}
                  >
                    {m.user.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm text-white">
                      {m.user.name}
                      {m.user.id === selfUserId && <span className="ml-1.5 text-xs text-slate-500">(you)</span>}
                    </div>
                    <div className="text-xs text-slate-500">
                      {m.permission === 'OWNER' ? 'Owner' : m.permission === 'EDITOR' ? 'Can edit' : 'Can view'}
                    </div>
                  </div>
                </div>
                {isOwner && m.user.id !== selfUserId && (
                  <div className="flex items-center gap-1">
                    <select
                      value={m.permission}
                      disabled={busy}
                      onChange={(e) => setPermission(m.user.id, e.target.value)}
                      className="rounded-md border border-slate-600/60 bg-slate-800 px-2 py-1 text-xs text-slate-300 outline-none cursor-pointer"
                    >
                      <option value="EDITOR">Can edit</option>
                      <option value="VIEWER">Can view</option>
                    </select>
                    <button
                      onClick={() => removeMember(m.user.id)}
                      disabled={busy}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-400 transition-colors cursor-pointer"
                      title="Remove member"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
