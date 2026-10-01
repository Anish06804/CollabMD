import { FileText } from 'lucide-react'
import { cn } from '../../lib/utils'

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const iconSize = size === 'lg' ? 32 : size === 'sm' ? 18 : 24
  const textSize = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-base' : 'text-xl'
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-600/30"
        style={{ width: iconSize + 16, height: iconSize + 16 }}
      >
        <FileText size={iconSize} className="text-white" />
      </div>
      <span className={cn('font-bold tracking-tight text-white', textSize)}>
        Collab<span className="text-blue-400">MD</span>
      </span>
    </div>
  )
}
