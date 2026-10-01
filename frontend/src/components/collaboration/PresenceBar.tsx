import type { Peer, PublicMember } from '../../types'
import { cn } from '../../lib/utils'

interface PresenceBarProps {
  peers: Peer[]
  members: PublicMember[]
  selfUserId: string
}

export function PresenceBar({ peers, members, selfUserId }: PresenceBarProps) {
  // Match by user ID (awareness broadcasts it) with a name fallback for
  // older clients — matching by name alone lights up EVERY member who shares
  // a display name, showing duplicates as "online".
  const isOnline = (m: PublicMember) =>
    m.user.id === selfUserId ||
    peers.some((p) => (p.user.id ? p.user.id === m.user.id : p.user.name === m.user.name))

  const onlineMembers = members.filter(isOnline)
  const offlineMembers = members.filter((m) => !isOnline(m))

  const shownOnline = onlineMembers.slice(0, 5)
  const shownOffline = offlineMembers.slice(0, 3)
  const shownCount = shownOnline.length + shownOffline.length
  const hiddenCount = members.length - shownCount

  return (
    <div className="flex items-center gap-1.5">
      {shownOnline.map((m) => (
        <div
          key={m.id}
          title={`${m.user.name} (online)`}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-slate-900',
            m.user.id === selfUserId && 'ring-blue-500/60',
          )}
          style={{ backgroundColor: m.user.color || '#6b7280' }}
        >
          {m.user.name.slice(0, 2).toUpperCase()}
        </div>
      ))}
      {shownOffline.map((m) => (
        <div
          key={m.id}
          title={`${m.user.name} (offline)`}
          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white opacity-35 ring-2 ring-slate-900 grayscale"
          style={{ backgroundColor: m.user.color || '#6b7280' }}
        >
          {m.user.name.slice(0, 2).toUpperCase()}
        </div>
      ))}
      {hiddenCount > 0 && (
        <div
          title={`${hiddenCount} more`}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-medium text-slate-300 ring-2 ring-slate-900"
        >
          +{hiddenCount}
        </div>
      )}
      <span className="ml-1.5 text-xs text-slate-400">
        {onlineMembers.length} online
      </span>
    </div>
  )
}
