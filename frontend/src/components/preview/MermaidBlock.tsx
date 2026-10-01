import { useEffect, useRef, useState } from 'react'
import { renderMermaid } from '../../lib/mermaid'
import { cn } from '../../lib/utils'

interface MermaidBlockProps {
  code: string
  index: number
}

/**
 * Renders a single ```mermaid fenced block to SVG using mermaid.js.
 * Debounces rendering while the user types and shows inline errors.
 * Optimized for real-time collaborative editing.
 */
export function MermaidBlock({ code, index }: MermaidBlockProps) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const renderCounter = useRef(0)
  const lastCode = useRef(code)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Skip if code hasn't changed and we already have a result
    if (code === lastCode.current && (svg || error)) return
    lastCode.current = code

    let cancelled = false
    setRendering(true)

    // Debounce: wait for typing to pause before rendering
    const timer = setTimeout(async () => {
      renderCounter.current += 1
      const { svg: result, error: err } = await renderMermaid(
        code,
        `mmd-${index}-${renderCounter.current}`,
      )
      if (cancelled) return
      setSvg(result)
      setError(err)
      setRendering(false)
    }, 150)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [code, index, svg, error])

  return (
    <div ref={containerRef} className="relative">
      {rendering && !svg && !error && (
        <div className="flex items-center justify-center py-8 text-slate-500 text-sm">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400 mr-2" />
          Rendering diagram…
        </div>
      )}
      {error && (
        <div className="mermaid-error">
          <strong>Diagram error:</strong> {error}
        </div>
      )}
      {svg && (
        <div
          className="mermaid-svg"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      {!svg && !error && !rendering && code.trim() && (
        <div className="text-slate-600 text-sm py-4 text-center">Preparing diagram…</div>
      )}
      {!code.trim() && (
        <div className="text-slate-600 text-sm py-4 text-center">Empty diagram</div>
      )}
    </div>
  )
}
