import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Square, Trash2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { api } from '../../lib/api'
import { toastError } from '../ui/Toaster'

interface CodeExecutorProps {
  /** The code to execute (from the selected code block) */
  code: string
  /** The language of the code block */
  language: string
  /** Whether the user can edit (viewers can't run code) */
  canEdit: boolean
}

interface ExecutionOutput {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
}

export function CodeExecutor({ code, language, canEdit }: CodeExecutorProps) {
  const [output, setOutput] = useState<ExecutionOutput | null>(null)
  const [running, setRunning] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const hasAutoRun = useRef(false)

  const run = useCallback(async () => {
    if (!code.trim() || running) return
    setRunning(true)
    setOutput(null)
    setCollapsed(false)
    try {
      const result = await api.executeCode(code, language)
      setOutput(result)
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Execution failed')
    } finally {
      setRunning(false)
    }
  }, [code, language, running])

  // Auto-run once when the panel opens with new code (like clicking Run)
  useEffect(() => {
    if (!hasAutoRun.current && canEdit && code.trim()) {
      hasAutoRun.current = true
      void run()
    }
  }, [canEdit, code, run])

  const stop = () => {
    // Note: server-side timeout handles actual stopping
    setRunning(false)
  }

  const clear = () => {
    setOutput(null)
  }

  return (
    <div className="border-t border-slate-800/60 bg-slate-900/80">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-1.5">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          Output
          {output && (
            <span
              className={cn(
                'ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-normal',
                output.exitCode === 0 && !output.timedOut
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-red-500/15 text-red-400',
              )}
            >
              {output.timedOut ? 'timeout' : `exit ${output.exitCode}`}
            </span>
          )}
        </button>
        <div className="flex items-center gap-1">
          {running ? (
            <button
              onClick={stop}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <Square size={11} />
              Stop
            </button>
          ) : (
            <button
              onClick={run}
              disabled={!canEdit || !code.trim()}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-emerald-400 hover:text-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              Run
            </button>
          )}
          <button
            onClick={clear}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Output content */}
      {!collapsed && (
        <div className="max-h-48 overflow-y-auto px-4 pb-3 font-mono text-xs">
          {running && (
            <div className="flex items-center gap-2 py-2 text-slate-500">
              <Loader2 size={12} className="animate-spin" />
              Executing {language}…
            </div>
          )}
          {output && !running && (
            <>
              {output.stdout && (
                <pre className="whitespace-pre-wrap text-slate-300 py-1">{output.stdout}</pre>
              )}
              {output.stderr && (
                <pre className="whitespace-pre-wrap text-red-400 py-1">{output.stderr}</pre>
              )}
              {output.timedOut && (
                <div className="text-amber-400 py-1">Execution timed out (10s limit)</div>
              )}
              {!output.stdout && !output.stderr && !output.timedOut && (
                <div className="text-slate-500 py-1">(no output)</div>
              )}
            </>
          )}
          {!output && !running && (
            <div className="text-slate-600 py-2">
              Select a code block and press Run to execute it here.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
