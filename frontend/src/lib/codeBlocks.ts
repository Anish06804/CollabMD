export interface CodeBlock {
  language: string
  code: string
  /** Start position in the document */
  start: number
  /** End position in the document */
  end: number
}

/**
 * Extract all fenced code blocks from markdown content.
 * Returns blocks with their positions so we can detect which one the cursor is in.
 */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  // Fence tag is optional and may be separated by spaces ("``` python" is
  // valid CommonMark) — the info string is everything up to the newline;
  // the language is its first word.
  const re = /```[ \t]*([^\n`]*)\r?\n([\s\S]*?)```/g
  let match: RegExpExecArray | null

  while ((match = re.exec(markdown)) !== null) {
    const info = match[1].trim()
    const language = (info.split(/\s+/)[0] || '').toLowerCase()
    const code = match[2].trim()
    const start = match.index
    const end = match.index + match[0].length
    blocks.push({ language, code, start, end })
  }

  return blocks
}

/**
 * Find the code block that contains the given cursor position.
 */
export function findCodeBlockAtPosition(blocks: CodeBlock[], pos: number): CodeBlock | null {
  for (const block of blocks) {
    if (pos >= block.start && pos <= block.end) {
      return block
    }
  }
  return null
}

/**
 * Find the code block closest to the given cursor position.
 */
export function findNearestCodeBlock(blocks: CodeBlock[], pos: number): CodeBlock | null {
  if (blocks.length === 0) return null
  let nearest = blocks[0]
  let minDist = Math.abs(pos - blocks[0].start)
  for (const block of blocks) {
    const dist = Math.abs(pos - block.start)
    if (dist < minDist) {
      minDist = dist
      nearest = block
    }
  }
  return nearest
}

import { getCachedLibrary, isRunnable } from './languageLibrary'
import { detectLanguage } from './languageDetect'

/**
 * Languages the backend can actually execute — decided by the server's
 * runtime probe (which languages have a working interpreter/compiler on the
 * host), not a hardcoded list. Until the library loads we fall back to the
 * common set so the Run button never flickers away.
 */
export const FALLBACK_EXECUTABLE = ['javascript', 'typescript', 'python', 'c', 'cpp'] as const

export function isExecutable(language: string): boolean {
  const id = language.toLowerCase()
  if (isRunnable(id)) return true
  // Before the first library load, use the common fallback set.
  if (getCachedLibrary().length > 0) return false
  return (FALLBACK_EXECUTABLE as readonly string[]).includes(id)
}

/**
 * Pick the best runnable block: the executable block containing the cursor,
 * otherwise the nearest executable block. Untagged blocks participate when
 * their content is recognizable as a runnable language (the fence tag is
 * written into the document when the run actually happens).
 * Returns null if none are runnable.
 */
export function findRunnableBlock(blocks: CodeBlock[], pos: number): CodeBlock | null {
  const runnable = blocks.filter((b) => {
    if (b.language) return isExecutable(b.language)
    const det = detectLanguage(b.code)
    return !!det.language && !det.uncertain && isExecutable(det.language.id)
  })
  if (runnable.length === 0) return null
  const atCursor = runnable.find((b) => pos >= b.start && pos <= b.end)
  if (atCursor) return atCursor
  return findNearestCodeBlock(runnable, pos)
}
