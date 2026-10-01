import { useMemo } from 'react'
import { splitMermaidSegments, renderMarkdownHtml } from '../../lib/markdown'
import { MermaidBlock } from './MermaidBlock'
import { cn } from '../../lib/utils'

interface MarkdownPreviewProps {
  content: string
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const segments = useMemo(() => splitMermaidSegments(content), [content])

  return (
    <div className={cn('markdown-preview px-8 py-6 overflow-y-auto h-full')}>
      {segments.map((seg, i) =>
        seg.type === 'mermaid' ? (
          <MermaidBlock key={i} code={seg.text} index={i} />
        ) : (
          <div key={i} dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(seg.text) }} />
        ),
      )}
      {segments.length === 0 && (
        <div className="text-slate-600 text-sm py-8 text-center">
          Nothing to preview yet — start typing in the editor.
        </div>
      )}
    </div>
  )
}
