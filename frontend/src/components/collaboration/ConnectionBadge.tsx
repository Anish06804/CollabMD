import type { ConnStatus } from '../../hooks/useCollaboration'
import { cn } from '../../lib/utils'

const config: Record<ConnStatus, { color: string; label: string; pulse: boolean }> = {
  connected: { color: 'bg-emerald-400', label: 'Connected', pulse: false },
  connecting: { color: 'bg-amber-400', label: 'Connecting…', pulse: true },
  disconnected: { color: 'bg-red-400', label: 'Reconnecting…', pulse: true },
}

export function ConnectionBadge({ status }: { status: ConnStatus }) {
  const c = config[status]
  return (
    <div className="flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-800/60 px-3 py-1.5">
      <span className={cn('h-2 w-2 rounded-full', c.color, c.pulse && 'animate-pulse-dot')} />
      <span className="text-xs font-medium text-slate-300">{c.label}</span>
    </div>
  )
}
