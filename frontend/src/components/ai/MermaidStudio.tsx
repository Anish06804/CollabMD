import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2, Copy, Check, AlertTriangle, Wand2, Code2, Eye } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'
import { api, type MermaidGeneration } from '../../lib/api'
import { renderMermaid, initMermaid } from '../../lib/mermaid'
import { toastError, toastSuccess } from '../ui/Toaster'

interface MermaidStudioProps {
  open: boolean
  onClose: () => void
  /** Insert the generated Mermaid block into the shared document. */
  onInsert: (code: string) => void
  /** Optional starting prompt (e.g. when invoked from an error hint). */
  initialPrompt?: string
  /** Current document content, sent as context so the AI can match naming. */
  documentContext?: string
  /** False when the reader may preview/copy but not write into the document. */
  canInsert?: boolean
}

const DIAGRAM_TYPES: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'flowchart', label: 'Flowchart' },
  { value: 'sequence', label: 'Sequence' },
  { value: 'class', label: 'Class' },
  { value: 'state', label: 'State' },
  { value: 'er', label: 'ER diagram' },
  { value: 'gantt', label: 'Gantt' },
  { value: 'pie', label: 'Pie chart' },
  { value: 'journey', label: 'User journey' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'mindmap', label: 'Mind map' },
]

const EXAMPLES = [
  'User opens app -> Login page -> Dashboard\nLogin page -> Error screen: wrong password',
  'Client sends login request\nServer returns JWT token',
  'Customer has many Orders\nOrder has many Items',
  'Draft -> Review: submit\nReview -> Published: approve\nReview -> Draft: reject',
  'Chrome 65\nSafari 20\nFirefox 10\nEdge 5',
  'Mind map: CollabMD\n  Editing\n    Markdown\n    Mermaid\n  Sharing\n    Rooms',
]

type Tab = 'preview' | 'code'

export function MermaidStudio({
  open,
  onClose,
  onInsert,
  initialPrompt = '',
  documentContext = '',
  canInsert = true,
}: MermaidStudioProps) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [type, setType] = useState('auto')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<MermaidGeneration | null>(null)
  const [editableCode, setEditableCode] = useState('')
  const [svg, setSvg] = useState<string | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [tab, setTab] = useState<Tab>('preview')
  const [copied, setCopied] = useState(false)
  const [engine, setEngine] = useState<{ engine: string; model?: string } | null>(null)
  const debouncedRender = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    initMermaid()
  }, [])

  // Which engine is active (shown honestly in the UI).
  useEffect(() => {
    if (!open) return
    api
      .getAiEngines()
      .then(setEngine)
      .catch(() => setEngine(null))
  }, [open])

  useEffect(() => {
    if (open && initialPrompt) setPrompt(initialPrompt)
  }, [open, initialPrompt])

  // Live-render the (possibly hand-edited) code with a debounce.
  const renderCode = useCallback((code: string) => {
    if (debouncedRender.current) clearTimeout(debouncedRender.current)
    if (!code.trim()) {
      setSvg(null)
      setRenderError(null)
      return
    }
    setRendering(true)
    debouncedRender.current = setTimeout(async () => {
      const { svg: out, error } = await renderMermaid(code, 'studio')
      setSvg(out)
      setRenderError(error)
      setRendering(false)
    }, 180)
  }, [])

  const generate = useCallback(async () => {
    if (!prompt.trim() || generating) return
    setGenerating(true)
    setRenderError(null)
    try {
      const res = await api.generateMermaid({
        prompt: prompt.trim(),
        type,
        context: documentContext ? documentContext.slice(0, 2000) : undefined,
      })
      setResult(res)
      setEditableCode(res.code)
      renderCode(res.code)
      // Warnings (e.g. "no tasks found") are shown in the result footer.
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }, [prompt, type, generating, documentContext, renderCode])

  // Re-render when the user edits the code by hand.
  useEffect(() => {
    if (editableCode && result) renderCode(editableCode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editableCode])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editableCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toastError('Clipboard unavailable')
    }
  }

  const handleInsert = () => {
    if (!canInsert || !editableCode.trim()) return
    onInsert(editableCode.trim())
    toastSuccess('Diagram inserted into document')
    onClose()
  }

  const insertReady = editableCode.trim().length > 0 && !renderError

  return (
    <Modal open={open} onClose={onClose} title="Mermaid Diagram Studio" wide>
      <div className="flex max-h-[75vh] flex-col gap-4">
        {/* Engine badge + type selector */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-fuchsia-400" />
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-lg border border-slate-700/60 bg-slate-800/60 px-2 py-1.5 text-xs text-slate-300 cursor-pointer hover:bg-slate-700/60 transition-colors"
            >
              {DIAGRAM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {engine && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium',
                engine.engine === 'llm'
                  ? 'bg-fuchsia-500/15 text-fuchsia-300'
                  : 'bg-slate-700/40 text-slate-400',
              )}
              title={
                engine.engine === 'llm'
                  ? `Using ${engine.model}`
                  : 'Offline parser: turns your text into Mermaid locally'
              }
            >
              {engine.engine === 'llm' ? `AI · ${engine.model ?? 'LLM'}` : 'Local engine'}
            </span>
          )}
        </div>

        {/* Prompt */}
        <div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void generate()
            }}
            placeholder={
              'Describe your diagram… e.g.\n' +
              'User opens app -> Login page -> Dashboard\n' +
              'Customer has many Orders'
            }
            rows={4}
            className="w-full resize-y rounded-xl border border-slate-700/60 bg-slate-800/50 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
          />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => setPrompt(ex)}
                className="max-w-40 truncate rounded-full border border-slate-700/50 bg-slate-800/40 px-2 py-0.5 text-[10px] text-slate-500 hover:border-slate-600 hover:text-slate-300 transition-colors cursor-pointer"
                title={ex.replace(/\n/g, ' | ')}
              >
                {ex.split('\n')[0].slice(0, 34)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <Button onClick={() => void generate()} disabled={!prompt.trim() || generating} size="sm">
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {generating ? 'Generating…' : 'Generate diagram'}
          </Button>
          <span className="text-[10px] text-slate-600">Ctrl+Enter</span>
        </div>

        {/* Result: preview / code tabs */}
        {result && (
          <div className="flex flex-col overflow-hidden rounded-xl border border-slate-700/50 bg-slate-950/40">
            <div className="flex items-center justify-between border-b border-slate-800/60 px-3 py-1.5">
              <div className="flex gap-1">
                <button
                  onClick={() => setTab('preview')}
                  className={cn(
                    'flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors cursor-pointer',
                    tab === 'preview' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300',
                  )}
                >
                  <Eye size={12} /> Preview
                </button>
                <button
                  onClick={() => setTab('code')}
                  className={cn(
                    'flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors cursor-pointer',
                    tab === 'code' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300',
                  )}
                >
                  <Code2 size={12} /> Code
                </button>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                <span>
                  {result.diagramType} · {result.stats.nodes} nodes · {result.stats.edges} edges
                </span>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {tab === 'preview' ? (
              <div className="flex min-h-40 max-h-72 items-center justify-center overflow-auto p-4">
                {rendering && (
                  <div className="flex items-center gap-2 text-slate-500">
                    <Loader2 size={14} className="animate-spin" /> Rendering…
                  </div>
                )}
                {!rendering && renderError && (
                  <div className="flex max-w-md items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <pre className="whitespace-pre-wrap font-mono text-[11px]">{renderError}</pre>
                  </div>
                )}
                {!rendering && !renderError && svg && (
                  <div
                    className="mermaid-preview [&_svg]:max-w-full [&_svg]:h-auto"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                )}
                {!rendering && !renderError && !svg && (
                  <div className="text-sm text-slate-600">No preview yet.</div>
                )}
              </div>
            ) : (
              <textarea
                value={editableCode}
                onChange={(e) => setEditableCode(e.target.value)}
                rows={10}
                spellCheck={false}
                className="w-full resize-y bg-transparent px-3 py-2.5 font-mono text-xs text-slate-300 focus:outline-none"
              />
            )}

            {/* Summary + warnings */}
            <div className="border-t border-slate-800/60 px-3 py-1.5 text-[11px] text-slate-500">
              <span>{result.summary}</span>
              {result.warnings.map((w, i) => (
                <span key={i} className="ml-2 text-amber-400/90">
                  ⚠ {w}
                </span>
              ))}
            </div>
          </div>
        )}

        {!result && (
          <div className="rounded-xl border border-dashed border-slate-700/50 px-4 py-8 text-center text-sm text-slate-600">
            Describe a flow, paste an outline, or pick an example above — the Studio turns it into a
            live Mermaid diagram.
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t border-slate-800/60 pt-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" onClick={handleInsert} disabled={!canInsert || !insertReady}>
            Insert into document
          </Button>
        </div>
      </div>
    </Modal>
  )
}
