/**
 * Diagram type taxonomy for the Mermaid Studio AI.
 *
 * `detectDiagramType` inspects free-form text and decides which Mermaid
 * diagram family it describes, so the generators don't have to guess.
 */

export type DiagramType =
  | 'flowchart'
  | 'sequence'
  | 'class'
  | 'state'
  | 'er'
  | 'gantt'
  | 'pie'
  | 'journey'
  | 'timeline'
  | 'mindmap'

export const DIAGRAM_TYPE_LABELS: Record<DiagramType, string> = {
  flowchart: 'Flowchart',
  sequence: 'Sequence diagram',
  class: 'Class diagram',
  state: 'State diagram',
  er: 'Entity-relationship diagram',
  gantt: 'Gantt chart',
  pie: 'Pie chart',
  journey: 'User journey',
  timeline: 'Timeline',
  mindmap: 'Mind map',
}

interface TypeRule {
  type: DiagramType
  patterns: RegExp[]
}

/**
 * Ordered: the first rule that scores above threshold wins. Order matters —
 * highly specific formats (gantt dates, pie percentages) must be tested
 * before the generic flowchart arrow patterns.
 */
const RULES: TypeRule[] = [
  {
    type: 'gantt',
    patterns: [
      /\bgantt\b/i,
      /\b(?:deadline|milestone|sprint plan|project schedule)\b/i,
      /\b\d{4}-\d{2}-\d{2}\b.*\b\d+(?:d|w|h)\b/i,
      /\b(?:start|begin)\s*(?:on\s*)?\d{1,2}\s+\w+\s*\d{4}/i,
      /\b\w+\s*:\s*(?:after|crit|active)?\s*\w*\s*\d{4}-\d{2}-\d{2}/i,
    ],
  },
  {
    type: 'pie',
    patterns: [
      /\bpie\b/i,
      /\bshow\s+(?:data|percentages?)\b/i,
      /\b(?:market share|breakdown|composition|proportion)\b/i,
      /(?:\d+(?:\.\d+)?)\s*%/g,
      // Lines that are just `Label number` (e.g. `Chrome 65` / `Chrome 65%`).
      /(?:^|\n)\s*[A-Za-z][\w .&/-]{0,40}?\s+\d+(?:\.\d+)?\s*%?\s*$/gm,
    ],
  },
  {
    type: 'sequence',
    patterns: [
      /\bsequence\s*diagram\b/i,
      /\bparticipant\b/i,
      // Explicit sequence message arrows: A ->> B / A -->> B (two angle
      // brackets — a plain `->` must NOT count, or every flowchart wins here).
      /-{1,3}>>(?!>)/g,
      // Actor-prefixed messages: `API -> Database: query`
      /(?:^|\n)\s*[\w .]+?\s*-{1,3}>\s*[\w .]+?\s*[:：]/gm,
      // Verbs that describe messages between parties.
      /\b(?:sends?|returns?|calls?|invokes?|notifies?|replies?|responds?|broadcasts?|publishes?|emits?)\b/g,
      /\b(?:request|response|callback|handshake)\s+(?:flow|cycle)\b/i,
      /\b(?:message|payload)\s+from\s+\w+\s+to\s+\w+/i,
    ],
  },
  {
    type: 'class',
    patterns: [
      /\b(?:class|object)\s+diagram\b/i,
      /\bclass\s+\w+\s*\{/i,
      /\b(?:extends|implements|inherits\s+from)\b/g,
      /\b(?:fields?|methods?|properties)\s*(?:and|&)?\s*(?:methods?|functions?)\b/i,
      /\+\w+\s*\([^)]*\)\s*:\s*\w+/i, // +doThing(): void
      /-\s*\w+\s*:\s*(?:string|int|number|boolean|bool|date|uuid)\b/i,
    ],
  },
  {
    type: 'state',
    patterns: [
      /\bstate\s*(?:diagram|machine|transition)?\b/i,
      /\b(?:lifecycle|status\s+(?:flow|transition)|finite\s+state)\b/i,
      /\[\*\]\s*-->/,
      // State-vocabulary words followed by a transition arrow.
      /\b(?:draft|review|pending|approved|rejected|published|submitted|archived|active|idle|queued|completed|failed|cancelled|running|waiting|open|closed|created|deleted|paid|shipped)\b[\s\S]{0,40}?-{1,3}>/gi,
      // Transition lines carrying an event: `Draft -> Review: submit`
      /\w+\s*->\s*\w+\s*[:：]\s*(?:submit|approve|reject|save|publish|archive|delete|update|create|login|logout|start|stop|cancel|confirm|pay|ship|deliver|finish|retry)\b/gi,
    ],
  },
  {
    type: 'er',
    patterns: [
      /\b(?:entity|erd|er)\s*diagram\b/i,
      /\b(?:primary\s+key|foreign\s+key|\bpk\b|\bfk\b)\b/i,
      /\bhas\s+many\s+\w+/g,
      /\b(?:belongs\s+to|one-to-many|many-to-many|one-to-one)\b/g,
      /\b(?:table|schema)\s+\w+\s*[\(\{]/i,
      // Table definition: `users(id: uuid, email: string)`
      /\b\w+\s*\([^)]*,[^)]*\)/g,
    ],
  },
  {
    type: 'journey',
    patterns: [
      /\b(?:user\s+journey|journey\s+map|customer\s+journey)\b/i,
      /\b(?:as\s+a\s+\w+|persona|pain\s+point|touchpoint)\b/i,
      // Steps written as `Task: score: Role`
      /(?:^|\n)\s*[\w /.-]{1,40}:\s*\d{1,2}\s*[:：]\s*\w+/gm,
      /\b(?:first|then|next|after\s+that)\b.*\b(?:feels?|frustrated|happy|satisfied)\b/i,
    ],
  },
  {
    type: 'timeline',
    patterns: [
      /\btimeline\b/i,
      /\b(?:roadmap|history\s+of|chronolog|milestones\s+(?:over|through))\b/i,
      /\b(?:q[1-4]\s+\d{4}|\d{4}\s*[-–]\s*\d{4})\b/i,
      // Period lines: `2024: Founded; Seed round`
      /(?:^|\n)\s*\d{4}\s*[:：\-–]/gm,
    ],
  },
  {
    type: 'mindmap',
    patterns: [
      /\bmind\s*map\b/i,
      /\bbrainstorm/i,
      /\bcentral\s+(?:idea|theme|topic)\b/i,
      /\b(?:root\s+idea|hierarchy\s+of\s+ideas)\b/i,
    ],
  },
  {
    type: 'flowchart',
    patterns: [
      /\b(?:flowchart|flow\s*chart|diagram|process)\b/i,
      /\b(?:workflow|decision\s+tree|pipeline|architecture)\b/i,
      // Arrows — counted globally so multi-hop lines outscore rivals on ties.
      /(?:-{1,3}>|={1,2}>|→)/g,
      /\b(?:then|next|leads?\s+to|results?\s+in)\b/g,
      /\b(?:if|check|verify|validate|decide)\b/g,
    ],
  },
]

/**
 * Decide which diagram family `text` describes.
 *
 * Every input maps to something — flowchart is the fallback — so callers can
 * generate without requiring an explicit type. Scores are counted per rule and
 * the first rule reaching a majority of the best score wins.
 */
export function detectDiagramType(text: string): DiagramType {
  const trimmed = (text || '').trim()
  if (!trimmed) return 'flowchart'

  let best: { type: DiagramType; score: number } = { type: 'flowchart', score: 0 }

  for (const rule of RULES) {
    let score = 0
    for (const pattern of rule.patterns) {
      // Reset lastIndex for global regexes reused across calls.
      pattern.lastIndex = 0
      const match = pattern.exec(trimmed)
      if (match) {
        // A global regex (like `x%`) may match repeatedly — count them.
        if (pattern.global) {
          let count = 0
          pattern.lastIndex = 0
          let m: RegExpExecArray | null
          while ((m = pattern.exec(trimmed)) !== null && count < 20) {
            count++
          }
          score += count
        } else {
          score += 1
        }
      }
    }
    if (score > best.score) best = { type: rule.type, score }
  }

  // Multiple strong signals in the same family should beat a lone weak one;
  // ties are resolved by rule order (specific types are listed first).
  return best.score > 0 ? best.type : 'flowchart'
}

/**
 * For sequence diagrams we also need to know whether the input already uses
 * arrow notation (A -> B: msg) or plain sentences (Client sends X to Server).
 */
export function usesArrowNotation(text: string): boolean {
  return /(?:^|\n)\s*\S+\s*-{2,}>?>?\s*\S+/m.test(text)
}
