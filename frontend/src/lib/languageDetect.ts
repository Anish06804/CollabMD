/**
 * Client-side language recognition — instant feedback while typing, without a
 * network round-trip. Mirrors the backend's signature-scoring approach with a
 * compact rule set covering the most common languages.
 *
 * Used for the VS Code-style language indicator in the status bar and for
 * auto-labelling code blocks that have no fence tag.
 */

export interface DetectionCandidate {
  id: string
  label: string
  color: string
  confidence: number
}

export interface DetectionResult {
  language: DetectionCandidate | null
  candidates: DetectionCandidate[]
  uncertain: boolean
}

interface Signature {
  re: RegExp
  w: number
  count?: boolean
}

const CATALOG: Record<string, { label: string; color: string }> = {
  javascript: { label: 'JavaScript', color: '#f7df1e' },
  typescript: { label: 'TypeScript', color: '#3178c6' },
  python: { label: 'Python', color: '#3776ab' },
  ruby: { label: 'Ruby', color: '#cc342d' },
  php: { label: 'PHP', color: '#777bb4' },
  java: { label: 'Java', color: '#b07219' },
  c: { label: 'C', color: '#555555' },
  cpp: { label: 'C++', color: '#f34b7d' },
  csharp: { label: 'C#', color: '#178600' },
  go: { label: 'Go', color: '#00add8' },
  rust: { label: 'Rust', color: '#dea584' },
  sql: { label: 'SQL', color: '#e38c00' },
  html: { label: 'HTML', color: '#e34c26' },
  css: { label: 'CSS', color: '#563d7c' },
  bash: { label: 'Bash', color: '#4eaa25' },
  powershell: { label: 'PowerShell', color: '#012456' },
  kotlin: { label: 'Kotlin', color: '#7F52FF' },
  swift: { label: 'Swift', color: '#F05138' },
  json: { label: 'JSON', color: '#292929' },
  yaml: { label: 'YAML', color: '#cb171e' },
  markdown: { label: 'Markdown', color: '#083fa1' },
  mermaid: { label: 'Mermaid', color: '#ff3670' },
  xml: { label: 'XML', color: '#0060ac' },
}

const SIGNATURES: Record<string, Signature[]> = {
  javascript: [
    { re: /\b(?:const|let|var)\s+\w+\s*=/, w: 4, count: true },
    { re: /=>/, w: 3, count: true },
    { re: /\bconsole\.(?:log|error|warn)\s*\(/, w: 5, count: true },
    { re: /\bfunction\s+\w*\s*\(/, w: 3, count: true },
    { re: /\brequire\s*\(\s*['"]/, w: 5, count: true },
    { re: /\bmodule\.exports\b/, w: 5 },
    { re: /\basync\s+function\b|\bawait\s+/, w: 3, count: true },
  ],
  typescript: [
    { re: /\binterface\s+\w+\s*\{/, w: 6, count: true },
    { re: /\btype\s+\w+\s*=\s*/, w: 5, count: true },
    { re: /:\s*(?:string|number|boolean|void|any|unknown|never)\b/, w: 5, count: true },
    { re: /\bimport\s+type\b/, w: 6 },
    { re: /\w+\?\s*:/, w: 3, count: true },
  ],
  python: [
    { re: /^\s*def\s+\w+\s*\([^)]*\)\s*:/m, w: 6, count: true },
    { re: /^\s*class\s+\w+(?:\([^)]*\))?\s*:/m, w: 5, count: true },
    { re: /^\s*(?:if|elif|else|for|while|try|except|with)\b.*:\s*$/m, w: 4, count: true },
    { re: /^\s*(?:import|from)\s+\w+/m, w: 5, count: true },
    { re: /\bprint\s*\(/, w: 3, count: true },
    { re: /\bself\b/, w: 3, count: true },
    { re: /\b(?:None|True|False)\b/, w: 4, count: true },
    { re: /f["']\{[^}]*\}/, w: 5, count: true },
  ],
  ruby: [
    { re: /^\s*def\s+\w+[?!]?\s*(?:\([^)]*\))?\s*$/m, w: 6, count: true },
    { re: /^\s*end\s*$/m, w: 3, count: true },
    { re: /\bputs\s+/, w: 4, count: true },
    { re: /\bdo\s*\|[^|]*\|/, w: 5, count: true },
    { re: /\brequire\s+['"]/, w: 4, count: true },
  ],
  php: [
    { re: /<\?php/, w: 10 },
    { re: /\$\w+\s*=/, w: 5, count: true },
    { re: /\b(?:echo|print)\s+/, w: 4, count: true },
    { re: /\?>/ , w: 4 },
  ],
  java: [
    { re: /System\.out\.println\s*\(/, w: 7, count: true },
    { re: /\bimport\s+java\.\w+/, w: 7, count: true },
    { re: /String\[\]\s+args/, w: 8 },
    { re: /\bpublic\s+(?:static\s+)?(?:void|class)\b/, w: 5, count: true },
  ],
  c: [
    { re: /#include\s*<(?:stdio|stdlib|string|math)\.h>/, w: 7, count: true },
    { re: /\b(?:printf|scanf)\s*\(/, w: 6, count: true },
    { re: /\bint\s+main\s*\(/, w: 6, count: true },
    { re: /\bmalloc\s*\(|\bfree\s*\(/, w: 5, count: true },
  ],
  cpp: [
    { re: /#include\s*<(?:iostream|vector|string|map|algorithm)>/, w: 7, count: true },
    { re: /\bstd::\w+/, w: 5, count: true },
    { re: /\bcout\s*<<|\bcin\s*>>/, w: 7, count: true },
    { re: /using\s+namespace\s+std\s*;/, w: 8 },
  ],
  csharp: [
    { re: /using\s+System\b/, w: 7, count: true },
    { re: /Console\.WriteLine\s*\(/, w: 7, count: true },
    { re: /\bnamespace\s+\w+/, w: 5, count: true },
  ],
  go: [
    { re: /package\s+main/, w: 6, count: true },
    { re: /\bfmt\.(?:Println|Printf|Print)\s*\(/, w: 7, count: true },
    { re: /\bfunc\s+(?:\([^)]+\)\s+)?\w+\s*\(/, w: 6, count: true },
    { re: /\bdefer\s+|\bgo\s+func\b/, w: 5, count: true },
  ],
  rust: [
    { re: /\bfn\s+\w+\s*\(/, w: 5, count: true },
    { re: /\blet\s+(?:mut\s+)?\w+/, w: 5, count: true },
    { re: /println!\s*\(/, w: 6, count: true },
    { re: /\buse\s+std::/, w: 6, count: true },
    { re: /\b(?:Some|None|Ok|Err)\b/, w: 4, count: true },
  ],
  sql: [
    { re: /\bSELECT\b[\s\S]*\bFROM\b/i, w: 8 },
    { re: /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE)\b/i, w: 8 },
    { re: /\b(?:JOIN|WHERE|GROUP\s+BY|ORDER\s+BY)\b/i, w: 5, count: true },
  ],
  html: [
    { re: /<!DOCTYPE\s+html>/i, w: 10 },
    { re: /<\/?(?:html|head|body|div|span|p|a|script)\b/i, w: 6, count: true },
  ],
  css: [
    { re: /[.#]?[\w-]+\s*\{[^}]*:[^}]*;/s, w: 6, count: true },
    { re: /\b(?:margin|padding|border|display|position|flex|grid)\s*:/, w: 5, count: true },
    { re: /@media|@keyframes/, w: 6, count: true },
  ],
  bash: [
    { re: /^#!.*\b(?:bash|sh|zsh)\b/m, w: 10 },
    { re: /^\s*(?:echo|export|cd|ls|cat|grep|awk|sed)\s+/m, w: 4, count: true },
    { re: /\$\{?\w+\}?/, w: 3, count: true },
    { re: /\|\s*(?:grep|awk|sed|wc|sort)/, w: 5, count: true },
  ],
  powershell: [
    { re: /^\s*(?:Get|Set|New|Remove|Test|Invoke)-\w+/m, w: 7, count: true },
    { re: /\bWhere-Object\b|\bForEach-Object\b/, w: 6, count: true },
    { re: /Write-Host|Write-Output/, w: 6, count: true },
    { re: /\bparam\s*\(/, w: 6, count: true },
  ],
  kotlin: [
    { re: /\bfun\s+\w+\s*\(/, w: 6, count: true },
    { re: /\b(?:val|var)\s+\w+\s*=/, w: 5, count: true },
    { re: /\bdata\s+class\s+\w+/, w: 7 },
  ],
  swift: [
    { re: /\bimport\s+(?:Foundation|SwiftUI|UIKit)\b/, w: 7, count: true },
    { re: /\bvar\s+\w+\s*:|\blet\s+\w+\s*:/, w: 5, count: true },
    { re: /\bguard\s+|\bdefer\s+/, w: 5, count: true },
  ],
  json: [
    { re: /^\s*[[{]/, w: 2, count: true },
    { re: /"[^"]+"\s*:/, w: 3, count: true },
    { re: /^\s*[\]}]\s*,?\s*$/m, w: 3, count: true },
  ],
  yaml: [
    { re: /^\s*[\w.-]+\s*:\s*\S/m, w: 4, count: true },
    { re: /^---\s*$/m, w: 5 },
    { re: /^\s*-\s+\w+/m, w: 3, count: true },
  ],
  markdown: [
    { re: /^#{1,6}\s+\S/m, w: 6, count: true },
    { re: /^\s*[-*]\s+\S/m, w: 3, count: true },
    { re: /\[([^\]]+)\]\([^)]+\)/, w: 5, count: true },
    { re: /^\s*>\s+\S/m, w: 4, count: true },
    { re: /\*\*[^*]+\*\*/, w: 4, count: true },
  ],
  mermaid: [
    { re: /^\s*(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|timeline|mindmap)\b/m, w: 10 },
  ],
  xml: [
    { re: /<\?xml[^?]*\?>/, w: 8 },
    { re: /<\/[\w:-]+>/, w: 5, count: true },
  ],
}

function toCandidate(id: string, confidence: number): DetectionCandidate | null {
  const meta = CATALOG[id]
  if (!meta) return null
  return { id, label: meta.label, color: meta.color, confidence: Math.max(0, Math.min(1, confidence)) }
}

/** Definitive markers that must win over keyword scoring. */
function directHint(code: string): DetectionResult | null {
  const first = (code.split(/\r?\n/, 1)[0] ?? '').toLowerCase()
  if (first.startsWith('#!')) {
    if (first.includes('python')) return single('python')
    if (first.includes('node')) return single('javascript')
    if (first.includes('ruby')) return single('ruby')
    if (first.includes('bash') || first.includes('zsh') || /\bsh\b/.test(first)) return single('bash')
    if (first.includes('pwsh') || first.includes('powershell')) return single('powershell')
  }
  if (/^\s*<\?php/m.test(code)) return single('php')
  if (/^\s*<!DOCTYPE html>/i.test(code)) return single('html')
  if (/^\s*(?:flowchart|graph\s+(?:TD|LR)|sequenceDiagram|stateDiagram|erDiagram|classDiagram)\b/m.test(code)) {
    return single('mermaid')
  }
  if (/^\s*\{[\s\S]*"\w+"\s*:/m.test(code) || /^\s*\[[\s\S]*\]/m.test(code)) {
    // Heuristic JSON: quoted keys with colons in braces/brackets.
    if (!/[;=]/.test(code)) return single('json')
  }
  return null
}

function single(id: string): DetectionResult | null {
  const c = toCandidate(id, 1)
  if (!c) return null
  return { language: c, candidates: [c], uncertain: false }
}

/**
 * Recognize the language of a snippet. Returns ranked candidates with
 * confidence 0..1; `uncertain` is true when the signal is weak or ambiguous.
 */
export function detectLanguage(code: string, hint?: string): DetectionResult {
  const trimmed = (code || '').trim()
  if (!trimmed) return { language: null, candidates: [], uncertain: true }

  const direct = directHint(trimmed)
  if (direct) return direct

  const scores = new Map<string, number>()
  for (const [langId, sigs] of Object.entries(SIGNATURES)) {
    let score = 0
    for (const sig of sigs) {
      const flags = sig.re.flags.includes('g') ? sig.re.flags : sig.re.flags + 'g'
      const matches = trimmed.match(new RegExp(sig.re.source, flags))
      if (!matches) continue
      score += sig.count ? sig.w * Math.min(matches.length, 5) : sig.w
    }
    if (score > 0) scores.set(langId, score)
  }

  if (hint) {
    const h = hint.toLowerCase()
    if (scores.has(h)) scores.set(h, (scores.get(h) ?? 0) + 4)
  }

  if (scores.size === 0) return { language: null, candidates: [], uncertain: true }

  const total = [...scores.values()].reduce((a, b) => a + b, 0)
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id, score]) => toCandidate(id, score / total))
    .filter((c): c is DetectionCandidate => c !== null)

  const top = ranked[0] ?? null
  const uncertain = total < 6 || (ranked[1] !== undefined && top !== null && top.confidence < 0.45)
  return { language: top, candidates: ranked, uncertain }
}
