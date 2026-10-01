import mermaid from 'mermaid'

let initialized = false

export function initMermaid() {
  if (initialized) return
  initialized = true
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict', // no HTML labels inside diagrams — XSS safe
    theme: 'dark',
    themeVariables: {
      fontFamily: "'Segoe UI', system-ui, sans-serif",
    },
  })
}

export interface MermaidRenderResult {
  svg: string | null
  error: string | null
}

/**
 * Render mermaid source to an SVG string. Uses a unique id per call so
 * repeated renders don't collide.
 */
export async function renderMermaid(code: string, idPrefix: string): Promise<MermaidRenderResult> {
  try {
    const id = `${idPrefix}-${Math.random().toString(36).slice(2, 10)}`
    const { svg } = await mermaid.render(id, code)
    return { svg, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { svg: null, error: message }
  }
}
