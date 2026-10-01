/**
 * Mermaid Diagram Studio AI
 *
 * Turns natural language / structured text into valid Mermaid diagram source.
 *
 * Two engines:
 *   1. `local`  — a real parser (no network, no API key) that understands
 *                 arrows, step lists, outlines, tables and plain-English
 *                 relationship phrasing, and emits correctly-formed Mermaid.
 *   2. `llm`    — used automatically when an API key is configured
 *                 (OPENAI_API_KEY / ANTHROPIC_API_KEY / GROQ_API_KEY). Falls
 *                 back to `local` on any error, so generation never fails.
 *
 * The response always reports which engine produced the result.
 */

import { detectDiagramType, type DiagramType } from './mermaidTypes.js'
import { generateLocal } from './mermaidLocal.js'
import { generateWithLlm } from './mermaidLlm.js'

export interface GenerateRequest {
  prompt: string
  /** Explicit type overrides auto-detection. */
  type?: DiagramType | 'auto'
  /** Optional document context so the AI can match naming/style. */
  context?: string
}

export interface GenerateResponse {
  code: string
  diagramType: DiagramType
  /** Which engine produced `code`. */
  engine: 'local' | 'llm'
  /** Model name when `engine === 'llm'`. */
  model?: string
  /** Short human-readable summary of how the input was interpreted. */
  summary: string
  /** Nodes/edges/steps recognised in the input. */
  stats: { nodes: number; edges: number; other?: number }
  warnings: string[]
}

/** Diagram types the studio can produce. */
export const DIAGRAM_TYPES: DiagramType[] = [
  'flowchart',
  'sequence',
  'class',
  'state',
  'er',
  'gantt',
  'pie',
  'journey',
  'timeline',
  'mindmap',
]

export async function generateDiagram(req: GenerateRequest): Promise<GenerateResponse> {
  const prompt = (req.prompt || '').trim()
  if (!prompt) {
    throw new Error('Prompt is empty — describe the diagram you want.')
  }

  const requested = req.type && req.type !== 'auto' ? req.type : undefined
  const detected = requested ?? detectDiagramType(prompt)

  // Prefer an LLM when one is configured; otherwise use the local parser.
  const llm = await generateWithLlm({ ...req, diagramType: detected })
  if (llm) return llm

  return generateLocal({ prompt, diagramType: detected, context: req.context })
}

export { detectDiagramType }
export type { DiagramType }
