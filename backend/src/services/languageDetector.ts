import { LANGUAGES, type LanguageSpec } from './languageLibrary.js'

/**
 * Language recognition: given an arbitrary code snippet, guess which
 * language it is written in.
 *
 * Uses weighted signature scoring rather than a single regex per language so
 * short or ambiguous snippets degrade gracefully into a ranked list instead of
 * a wrong answer. Signatures are ordered from strong (unique syntax) to weak
 * (common keywords) and every hit contributes to a score.
 */

export interface DetectionCandidate {
  id: string
  label: string
  color: string
  /** 0..1 — confidence relative to the total score of all candidates. */
  confidence: number
}

export interface DetectionResult {
  /** Best match, or null when nothing scored above the threshold. */
  language: DetectionCandidate | null
  candidates: DetectionCandidate[]
  /** True when the snippet was too short/ambiguous to classify reliably. */
  uncertain: boolean
}

interface Signature {
  /** Matches against the whole snippet. */
  re: RegExp
  /** Relative weight of this signal. */
  w: number
  /** Count-based scoring: score = w * min(matches, cap) instead of a flat hit. */
  count?: boolean
}

/** Shared weak signals so common keywords don't dominate any one language. */
const C_BRACE = { re: /(?:^|\n)\s*(?:if|for|while)\s*\([^)]*\)\s*\{/, w: 1, count: true }

const SIGNATURES: Record<string, Signature[]> = {
  javascript: [
    { re: /\b(?:const|let|var)\s+\w+\s*=/, w: 4, count: true },
    { re: /=>\s*[{(]|=>\s*\w/, w: 4, count: true },
    { re: /\bconsole\.(?:log|error|warn)\s*\(/, w: 5, count: true },
    { re: /\bfunction\s+\w*\s*\(/, w: 3, count: true },
    { re: /\brequire\s*\(\s*['"]/, w: 5, count: true },
    { re: /\bimport\s+.*\bfrom\s+['"]/, w: 4, count: true },
    { re: /\bmodule\.exports\b|\bexports\.\w+/, w: 5, count: true },
    { re: /\basync\s+function\b|\bawait\s+/, w: 3, count: true },
    { re: /\.\s*(?:then|catch)\s*\(/, w: 3, count: true },
    { re: /\b(?:document|window|localStorage)\./, w: 3, count: true },
    C_BRACE,
  ],
  typescript: [
    { re: /\binterface\s+\w+\s*\{/, w: 6, count: true },
    { re: /\btype\s+\w+\s*=\s*/, w: 5, count: true },
    { re: /:\s*(?:string|number|boolean|void|any|unknown|never)\b/, w: 5, count: true },
    { re: /\b(?:public|private|protected|readonly)\s+\w+\s*[:(]/, w: 4, count: true },
    { re: /\bas\s+(?:string|number|any|const)\b/, w: 4, count: true },
    { re: /\benum\s+\w+\s*\{/, w: 5, count: true },
    { re: /<T(?:\s|,|>)/, w: 3, count: true },
    { re: /\w+\?\s*:/, w: 3, count: true },
    { re: /\bimport\s+type\b/, w: 6 },
  ],
  python: [
    { re: /^\s*def\s+\w+\s*\([^)]*\)\s*:/m, w: 6, count: true },
    { re: /^\s*class\s+\w+(?:\([^)]*\))?\s*:/m, w: 5, count: true },
    { re: /^\s*(?:if|elif|else|for|while|try|except|finally|with)\b.*:\s*$/m, w: 5, count: true },
    { re: /^\s*import\s+\w+|^\s*from\s+\w+\s+import/m, w: 5, count: true },
    { re: /\bprint\s*\(/, w: 3, count: true },
    { re: /\bself\b/, w: 3, count: true },
    { re: /f["']\{[^}]*\}/, w: 5, count: true },
    { re: /^\s*@\w+/m, w: 3, count: true },
    { re: /\b(?:None|True|False)\b/, w: 4, count: true },
    { re: /\blambda\s+[\w\s]*:/, w: 4, count: true },
    { re: /:\s*$/m, w: 1, count: true },
    { re: /^\s{4}\S/m, w: 2, count: true }, // 4-space indentation block
  ],
  ruby: [
    { re: /\bdef\s+\w+[?!]?\s*(?:\([^)]*\))?\s*$/m, w: 6, count: true },
    { re: /^\s*end\s*$/m, w: 4, count: true },
    { re: /\bputs\s+/, w: 4, count: true },
    { re: /\bdo\s*\|[^|]*\|/, w: 5, count: true },
    { re: /\brequire\s+['"]/, w: 5, count: true },
    { re: /\battr_(?:reader|writer|accessor)\b/, w: 6 },
    { re: /@\w+\s*=/, w: 3, count: true },
    { re: /\b(?:nil|true|false)\b/, w: 3, count: true },
    { re: /\bmodule\s+\w+/, w: 4, count: true },
  ],
  php: [
    { re: /<\?php/, w: 10 },
    { re: /\$\w+\s*=/, w: 5, count: true },
    { re: /\bfunction\s+\w+\s*\(/, w: 3, count: true },
    { re: /\b(?:echo|print)\s+/, w: 4, count: true },
    { re: /->\w+\s*\(/, w: 3, count: true },
    { re: /\barray\s*\(/, w: 4, count: true },
    { re: /\?>/ , w: 4 },
    { re: /\b(?:public|private|protected)\s+(?:function|\$)/, w: 5, count: true },
  ],
  java: [
    { re: /\bpublic\s+(?:static\s+)?(?:void|class)\b/, w: 6, count: true },
    { re: /System\.out\.println\s*\(/, w: 7, count: true },
    { re: /\bimport\s+java\.\w+/, w: 7, count: true },
    { re: /\b(?:private|protected|public)\s+[\w<>\[\]]+\s+\w+\s*[;=(]/, w: 4, count: true },
    { re: /\bnew\s+\w+\s*\(/, w: 3, count: true },
    { re: /\bthrows?\s+\w+/, w: 4, count: true },
    { re: /\bString\[\]\s+args/, w: 8 },
    { re: /\b(?:@Override|@Deprecated)\b/, w: 6 },
    { re: /\bclass\s+\w+\s*(?:extends|implements)?/, w: 3, count: true },
  ],
  c: [
    { re: /#include\s*<(?:stdio|stdlib|string|math)\.h>/, w: 7, count: true },
    { re: /\bprintf\s*\(/, w: 6, count: true },
    { re: /\bint\s+main\s*\(/, w: 6, count: true },
    { re: /\bmalloc\s*\(|\bfree\s*\(/, w: 5, count: true },
    { re: /\bscanf\s*\(/, w: 6, count: true },
    { re: /\breturn\s+0\s*;/, w: 3, count: true },
    { re: /(?:^|\n)\s*#\s*define\b/, w: 4, count: true },
    { re: /\bchar\s*\*|char\s+\w+\s*\[/, w: 3, count: true },
  ],
  cpp: [
    { re: /#include\s*<(?:iostream|vector|string|map|set|algorithm)>/, w: 7, count: true },
    { re: /\bstd::\w+/, w: 6, count: true },
    { re: /\bcout\s*<<|\bcin\s*>>/, w: 7, count: true },
    { re: /\busing\s+namespace\s+std\s*;/, w: 8 },
    { re: /\btemplate\s*<</, w: 5, count: true },
    { re: /\b(?:nullptr|constexpr|auto)\b/, w: 4, count: true },
    { re: /\bstd::\s*(?:vector|string|map)\s*</, w: 5, count: true },
  ],
  csharp: [
    { re: /\busing\s+System\b/, w: 7, count: true },
    { re: /Console\.WriteLine\s*\(/, w: 7, count: true },
    { re: /\bnamespace\s+\w+/, w: 5, count: true },
    { re: /\b(?:public|private|internal)\s+(?:static\s+)?(?:class|void|string|int)\b/, w: 4, count: true },
    { re: /\bvar\s+\w+\s*=/, w: 3, count: true },
    { re: /\bstring\[\]\s+args\b/, w: 6 },
    { re: /=>\s*[^;]+;/, w: 2, count: true },
  ],
  go: [
    { re: /package\s+main/, w: 6, count: true },
    { re: /\bfunc\s+(?:\([^)]+\)\s+)?\w+\s*\(/, w: 6, count: true },
    { re: /\bfmt\.(?:Println|Printf|Print)\s*\(/, w: 7, count: true },
    { re: /\bimport\s*\(/, w: 5, count: true },
    { re: /\bvar\s+\w+\s+\w+/, w: 4, count: true },
    { re: /\bmake\s*\((?:map|chan|\[\])/, w: 5, count: true },
    { re: /\bgo\s+func\s*\(|\bdefer\s+/, w: 5, count: true },
    { re: /\bnil\b/, w: 3, count: true },
  ],
  rust: [
    { re: /\bfn\s+\w+\s*\(/, w: 5, count: true },
    { re: /\blet\s+(?:mut\s+)?\w+/, w: 5, count: true },
    { re: /\bprintln!\s*\(|\bprint!\s*\(/, w: 6, count: true },
    { re: /\buse\s+std::/, w: 6, count: true },
    { re: /->\s*(?:\w+|Result<|Option<)/, w: 4, count: true },
    { re: /\bimpl\s+\w+/, w: 5, count: true },
    { re: /\bSome\s*\(|\bNone\b|\bOk\s*\(|\bErr\s*\(/, w: 5, count: true },
    { re: /\bpub\s+(?:fn|struct|enum|mod)\b/, w: 5, count: true },
    { re: /#\[[\w:]+\]/, w: 4, count: true },
    { re: /&\w+|&mut\b/, w: 3, count: true },
  ],
  sql: [
    { re: /\bSELECT\b[\s\S]*\bFROM\b/i, w: 8, count: true },
    { re: /\bINSERT\s+INTO\b/i, w: 8 },
    { re: /\bUPDATE\b[\s\S]*\bSET\b/i, w: 8 },
    { re: /\bDELETE\s+FROM\b/i, w: 8 },
    { re: /\bCREATE\s+TABLE\b/i, w: 8 },
    { re: /\bJOIN\b|\bLEFT\s+JOIN\b|\bINNER\s+JOIN\b/i, w: 6, count: true },
    { re: /\bWHERE\b|\bGROUP\s+BY\b|\bORDER\s+BY\b/i, w: 5, count: true },
    { re: /\b(?:VARCHAR|INT|INTEGER|TIMESTAMP|BOOLEAN|SERIAL)\b/i, w: 5, count: true },
  ],
  html: [
    { re: /<!DOCTYPE\s+html>/i, w: 10 },
    { re: /<\/?(?:html|head|body|div|span|p|a|script|link|meta)\b/i, w: 6, count: true },
    { re: /<[a-z][\w-]*\s[^>]*>/i, w: 3, count: true },
    { re: /\b(?:class|id|href|src)\s*=/, w: 3, count: true },
    { re: /<\?php/, w: -20 }, // PHP wins over HTML when both present
  ],
  css: [
    { re: /[.#]?[\w-]+\s*\{[^}]*:[^}]*;/s, w: 6, count: true },
    { re: /\b(?:margin|padding|border|display|position|flex|grid)\s*:/, w: 5, count: true },
    { re: /@media|@keyframes|@import/, w: 6, count: true },
    { re: /:\s*(?:hover|focus|active|before|after)\b/, w: 5, count: true },
    { re: /--[a-z-]+\s*:/, w: 4, count: true },
    { re: /\b(?:rgb|hsl)a?\s*\(/, w: 3, count: true },
  ],
  bash: [
    { re: /^#!.*\b(?:bash|sh|zsh)\b/m, w: 10 },
    { re: /^\s*(?:echo|export|cd|ls|cat|grep|awk|sed)\s+/m, w: 4, count: true },
    { re: /\$\{?\w+\}?/, w: 3, count: true },
    { re: /\bif\s+\[\[?|\bthen\b|\bfi\b|\bfor\s+\w+\s+in\b/, w: 5, count: true },
    { re: /\|\s*(?:grep|awk|sed|wc|sort)/, w: 5, count: true },
    { re: /^\s*(?:function\s+)?\w+\s*\(\)\s*\{/m, w: 4, count: true },
    { re: />>?|<<\s*'?<?\w*'?/, w: 2, count: true },
  ],
  powershell: [
    { re: /^\s*(?:Get|Set|New|Remove|Test|Invoke)-\w+/m, w: 7, count: true },
    { re: /\$\w+\s*=/, w: 3, count: true },
    { re: /\|[\s\S]*?\bWhere-Object\b|\|[\s\S]*?\bForEach-Object\b/, w: 6, count: true },
    { re: /\bparam\s*\(/, w: 6, count: true },
    { re: /Write-Host|Write-Output/, w: 6, count: true },
    { re: /-ArgumentList|-Path|-Name\b/, w: 3, count: true },
    { re: /\bfunction\s+\w+\s*\{/, w: 3, count: true },
  ],
  kotlin: [
    { re: /\bfun\s+(?:main\s*\(|\w+\s*\()/, w: 6, count: true },
    { re: /\bval\s+\w+\s*=|\bvar\s+\w+\s*=/, w: 5, count: true },
    { re: /\bprintln\s*\(/, w: 3, count: true },
    { re: /\b(?:when|is)\s+\w+\s*->/, w: 5, count: true },
    { re: /\bdata\s+class\s+\w+/, w: 7 },
    { re: /\bpackage\s+\w+/, w: 3, count: true },
    { re: /\bobject\s+:\s*\w+|\bcompanion\s+object\b/, w: 5, count: true },
    { re: /\b(?:null|true|false)\b/, w: 2, count: true },
  ],
  swift: [
    { re: /\bfunc\s+\w+\s*\(/, w: 4, count: true },
    { re: /\bvar\s+\w+\s*:|\blet\s+\w+\s*:/, w: 5, count: true },
    { re: /\bimport\s+(?:Foundation|SwiftUI|UIKit)\b/, w: 7, count: true },
    { re: /\bprint\s*\(/, w: 2, count: true },
    { re: /\b(?:guard|defer)\s+.*\bthen\b|\bguard\s+/, w: 5, count: true },
    { re: /\?\?|\bas\??/, w: 3, count: true },
    { re: /\bself\.\w+|\bfunc\s+\w+\(.*\)\s*->/, w: 3, count: true },
    { re: /\b(?:String|Int|Bool|Array|Dictionary)\b/, w: 3, count: true },
  ],
}

/**
 * Snippet-level hints that override scoring entirely — shebangs and file
 * markers are definitive and must win over keyword noise.
 */
function directHint(code: string): LanguageSpec | null {
  const firstLine = code.split(/\r?\n/, 1)[0] ?? ''
  const shebang = firstLine.match(/^#!\s*(\S+)(?:\s+(\S+))?/)
  if (shebang) {
    // `#!/usr/bin/env python3` puts the interpreter in group 2.
    const cmd = ((shebang[2] ?? shebang[1]) + ' ' + (shebang[2] ? shebang[1] : '')).toLowerCase()
    if (cmd.includes('python')) return byExt('py')
    if (cmd.includes('node')) return byExt('js')
    if (cmd.includes('ruby')) return byExt('rb')
    if (cmd.includes('bash')) return byExt('sh')
    if (cmd.includes('zsh')) return byExt('zsh')
    if (cmd.includes('pwsh') || cmd.includes('powershell')) return byExt('ps1')
    if (/\bsh\b/.test(cmd)) return byExt('sh')
  }
  if (/^\s*<\?php/m.test(code)) return byExt('php')
  if (/^\s*<!DOCTYPE html>/i.test(code)) return byExt('html')
  return null
}

function byExt(ext: string): LanguageSpec | null {
  return LANGUAGES.find((l) => l.ext === ext) ?? null
}

/**
 * Recognize the language of a code snippet.
 *
 * @param code     the snippet
 * @param hint     an optional known fence tag / extension, used to break ties
 */
export function detectLanguage(code: string, hint?: string): DetectionResult {
  const trimmed = (code || '').trim()
  const candidates: DetectionCandidate[] = []

  // 1. Definitive markers win outright.
  const direct = directHint(trimmed)
  if (direct) {
    return {
      language: toCandidate(direct, 1),
      candidates: [toCandidate(direct, 1)],
      uncertain: false,
    }
  }

  // 2. Weighted signature scoring.
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

  // 3. A known fence tag / extension acts as a tie-breaker (same language
  //    family gets a bonus, e.g. ` ```js ` over `javascript` alternatives).
  if (hint) {
    const hinted = LANGUAGES.find(
      (l) => l.id === hint.toLowerCase() || l.ext === hint.toLowerCase() || l.aliases.includes(hint.toLowerCase()),
    )
    if (hinted) scores.set(hinted.id, (scores.get(hinted.id) ?? 0) + 4)
  }

  if (scores.size === 0) {
    return { language: null, candidates: [], uncertain: true }
  }

  const total = [...scores.values()].reduce((a, b) => a + b, 0)
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, score]) => {
      const spec = LANGUAGES.find((l) => l.id === id)!
      return toCandidate(spec, score / total)
    })

  const top = ranked[0]
  // Few total signal points → we're guessing; flag it as uncertain.
  const uncertain = total < 6 || (ranked[1] && top.confidence < 0.45)
  return { language: top, candidates: ranked, uncertain: !!uncertain }
}

function toCandidate(spec: LanguageSpec, confidence: number): DetectionCandidate {
  return {
    id: spec.id,
    label: spec.label,
    color: spec.color,
    confidence: Math.max(0, Math.min(1, confidence)),
  }
}
