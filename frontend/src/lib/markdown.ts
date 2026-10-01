import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const md: MarkdownIt = new MarkdownIt({
  html: false, // never pass through raw HTML — XSS safe
  linkify: true,
  breaks: false,
})

export interface Segment {
  type: 'markdown' | 'mermaid'
  text: string
}

/**
 * Split markdown into alternating markdown / mermaid segments so mermaid
 * blocks can be rendered by mermaid.js (not markdown-it) and everything
 * else by markdown-it.
 */
export function splitMermaidSegments(markdown: string): Segment[] {
  const segments: Segment[] = []
  const re = /```[ \t]*mermaid[ \t]*\r?\n([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(markdown)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'markdown', text: markdown.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'mermaid', text: match[1].trim() })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < markdown.length) {
    segments.push({ type: 'markdown', text: markdown.slice(lastIndex) })
  }
  return segments
}

/** Render a markdown segment to sanitized HTML. */
export function renderMarkdownHtml(markdown: string): string {
  const raw = md.render(markdown)
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  })
}
