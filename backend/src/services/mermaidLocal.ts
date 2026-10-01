/**
 * Local (offline) Mermaid generator.
 *
 * Parses natural language, arrow notation, step lists, indented outlines and
 * table definitions into structured graph data, then emits correctly-formed
 * Mermaid source for the requested diagram type. No network, no API key —
 * this is what makes the Studio work out of the box.
 */

import type { DiagramType, GenerateResponse } from './mermaidAi.js'
import { usesArrowNotation } from './mermaidTypes.js'

export interface LocalGenerateArgs {
  prompt: string
  diagramType: DiagramType
  context?: string
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** Escape a label for use inside Mermaid's quoted strings. */
function esc(label: string): string {
  return label
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '#quot;')
    .replace(/[#\[\]{}|;]/g, (ch) => `#${ch.charCodeAt(0)};`)
    .replace(/\n/g, ' ')
}

/** Mermaid id-safe slug, prefixed so keywords (graph, end) can't collide. */
function slug(raw: string, used: Map<string, number>): string {
  let base = raw
    .toLowerCase()
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!base) base = 'node'
  if (/^(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|timeline|mindmap|end)$/.test(base)) {
    base = `n_${base}`
  }
  const n = used.get(base) ?? 0
  used.set(base, n + 1)
  return n === 0 ? base : `${base}_${n}`
}



/** New counter map for de-duplicating slugs. */
function newIdCounters(): Map<string, number> {
  return new Map<string, number>()
}

/** New label→id map so node definitions can be emitted from labels. */
function newLabelMap(): Map<string, string> {
  return new Map<string, string>()
}

/** Get or create a slug for a label, memoized by exact label. */
function idFor(label: string, used: Map<string, number>, byLabel: Map<string, string>): string {
  const key = label.trim()
  const existing = byLabel.get(key)
  if (existing) return existing
  const id = slug(key, used)
  byLabel.set(key, id)
  return id
}

interface ParsedLine {
  text: string
  indent: number
  listMarker: boolean
}

/** Split into lines carrying indentation + bullet info (bullets stripped). */
function parseOutline(input: string): ParsedLine[] {
  const out: ParsedLine[] = []
  for (const raw of input.split(/\r?\n/)) {
    const indent = (raw.match(/^[ \t]*/) ?? [''])[0].replace(/\t/g, '  ').length
    const m = raw.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/)
    const text = (m ? m[1] : raw).trim()
    if (!text) continue
    out.push({ text, indent, listMarker: !!m })
  }
  return out
}

/** Recognise the arrow idiom used across the generators. */
interface Arrow {
  from: string
  to: string
  label?: string
}

/** Parse `A -> B`, `A -->|label| B`, `A --> label --> B`-style lines.
 *  Multi-arrow chains (`A -> B -> C`) expand into consecutive pairs. */
function parseArrows(line: string): Arrow[] {
  // A -->|label| B
  const piped = line.match(/^(.+?)\s*-{1,3}>\s*\|([^|]+)\|\s*(.+)$/)
  if (piped) return [{ from: piped[1].trim(), to: piped[3].trim(), label: piped[2].trim() }]
  // A -- label --> B  /  A --- label ---> B
  const labelled = line.match(/^(.+?)\s*-{2,3}\s+(.+?)\s+-{2,3}>\s*(.+)$/)
  if (labelled) return [{ from: labelled[1].trim(), to: labelled[3].trim(), label: labelled[2].trim() }]

  // Plain arrows — split so `A -> B -> C` becomes A->B and B->C rather than
  // a single node labelled "B -> C".
  const parts = line.split(/(?:-{1,3}>|={2,}>|→)/).map((p) => p.trim())
  if (parts.length < 2) return []

  const arrows: Arrow[] = []
  for (let i = 0; i < parts.length - 1; i++) {
    let to = parts[i + 1]
    let label: string | undefined
    if (i === parts.length - 2) {
      // Only the final segment carries the `: label` suffix.
      const labelledEnd = to.match(/^(.+?)\s*[:：]\s*(.+)$/)
      if (labelledEnd) {
        to = labelledEnd[1].trim()
        label = labelledEnd[2].trim()
      }
    }
    if (parts[i] && to) arrows.push(label ? { from: parts[i], to, label } : { from: parts[i], to })
  }
  return arrows
}

/** Split `A has many B` / `A contains B` phrasing into two entity names. */
function parseRelationPhrase(line: string): { a: string; b: string; phrase: string } | null {
  const patterns = [
    /^(?:the\s+)?(\w[\w ]*?)\s+has\s+many\s+(?:the\s+)?(\w[\w ]*?)$/i,
    /^(?:the\s+)?(\w[\w ]*?)\s+has\s+one\s+(?:the\s+)?(\w[\w ]*?)$/i,
    /^(?:the\s+)?(\w[\w ]*?)\s+(?:contains|includes|owns)\s+(?:the\s+)?(\w[\w ]*?)$/i,
    /^(?:the\s+)?(\w[\w ]*?)\s+belongs\s+to\s+(?:the\s+)?(\w[\w ]*?)$/i,
    /^(?:the\s+)?(\w[\w ]*?)\s+(?:references|links?\s+to)\s+(?:the\s+)?(\w[\w ]*?)$/i,
  ]
  for (const p of patterns) {
    const m = line.match(p)
    if (m) return { a: m[1].trim(), b: m[2].trim(), phrase: m[0].trim() }
  }
  return null
}

/** Pull `Label 40%` / `Label: 40` / `Label - 40` pairs for pie charts. */
function parseShare(line: string): { label: string; value: number } | null {
  const m =
    line.match(/^(.+?)\s*[:\-–]?\s*(\d+(?:\.\d+)?)\s*%?\s*$/) ??
    line.match(/^(.+?)\s+is\s+(\d+(?:\.\d+)?)\s*%?/i)
  if (!m) return null
  const label = m[1].replace(/[:\-–,]/g, '').trim()
  const value = Number(m[2])
  if (!label || Number.isNaN(value)) return null
  return { label, value }
}

/** `Task: 2026-01-01, 7d` / `Task: 2026-01-01 for 7d` / `Task: after X, 5d`. */
function parseGanttTask(line: string): { name: string; start: string; duration: string; after?: string; section?: string } | null {
  const m = line.match(/^(.+?)\s*[:：]\s*(.+)$/)
  if (!m) return null
  const name = m[1].trim()
  const rest = m[2].trim()

  const after = rest.match(/^after\s+([\w -]+?)(?:,\s*(\d+[hdw]))?$/i)
  if (after) {
    return { name, start: '', duration: after[2] ?? '1d', after: after[1].trim() }
  }
  const span = rest.match(/^(\d{4}-\d{2}-\d{2})\s*(?:,|for|to)\s*(\d+[hdw])$/i)
  if (span) return { name, start: span[1], duration: span[2].toLowerCase() }
  const startOnly = rest.match(/^(\d{4}-\d{2}-\d{2})(?:\s*,\s*(\d+[hdw]))?$/i)
  if (startOnly) return { name, start: startOnly[1], duration: startOnly[2] ?? '5d' }
  const durationOnly = rest.match(/^(\d+[hdw])$/i)
  if (durationOnly) return { name, start: '', duration: durationOnly[1].toLowerCase() }
  return null
}

/** Journey line: `Task: 5: User` (mermaid's own order) or `User: Task (5)`. */
function parseJourneyStep(line: string): { task: string; score: number; role: string } | null {
  const mermaidOrder = line.match(/^(.+?)\s*[:：]\s*(\d{1,2})\s*[:：]\s*(.+)$/)
  if (mermaidOrder) {
    return { task: mermaidOrder[1].trim(), score: clampScore(Number(mermaidOrder[2])), role: mermaidOrder[3].trim() }
  }
  const roleFirst = line.match(/^(.+?)\s+(?:as|scores?)\s+(\d{1,2})\s*[:：]?\s*(.+)$/i)
  if (roleFirst) {
    return { role: roleFirst[1].trim(), score: clampScore(Number(roleFirst[2])), task: roleFirst[3].trim() }
  }
  return null
}

function clampScore(n: number): number {
  if (Number.isNaN(n)) return 5
  return Math.max(1, Math.min(10, n))
}

function stats(nodes: number, edges: number, other?: number): GenerateResponse['stats'] {
  return other === undefined ? { nodes, edges } : { nodes, edges, other }
}

const EMPTY_WARNINGS: string[] = []

/* ------------------------------------------------------------------ */
/* Generators                                                          */
/* ------------------------------------------------------------------ */

/** Flowchart from arrows, step chains, or indented hierarchy. */
function genFlowchart(prompt: string): GenerateResponse {
  const lines = parseOutline(prompt)
  const used = newIdCounters()
  const byLabel = newLabelMap()
  const arrows: Arrow[] = []
  const decisions: string[] = []
  const nodes = new Set<string>()
  const warnings: string[] = []

  const dir = /\b(left to right|horizontal|lr)\b/i.test(prompt)
    ? 'LR'
    : /\b(bottom up|bt)\b/i.test(prompt)
      ? 'BT'
      : 'TD'

  for (const line of lines) {
    const parsed = parseArrows(line.text)
    if (parsed.length > 0) {
      for (const arrow of parsed) {
        arrows.push(arrow)
        nodes.add(idFor(arrow.from, used, byLabel))
        nodes.add(idFor(arrow.to, used, byLabel))
      }
      continue
    }
    // `if X then A else B` → decision diamond with two labelled branches
    const cond = line.text.match(/^if\s+(.+?)\s+then\s+(.+?)(?:\s+else\s+(.+))?$/i)
    if (cond) {
      const c = idFor(cond[1], used, byLabel)
      const yes = idFor(cond[2], used, byLabel)
      nodes.add(c)
      nodes.add(yes)
      // Store the human labels — the emitter resolves labels → ids.
      arrows.push({ from: cond[1].trim(), to: cond[2].trim(), label: 'yes' })
      decisions.push(cond[1].trim())
      if (cond[3]) {
        nodes.add(idFor(cond[3], used, byLabel))
        arrows.push({ from: cond[1].trim(), to: cond[3].trim(), label: 'no' })
      }
      continue
    }
  }

  let summary: string

  if (arrows.length > 0) {
    summary = `Parsed ${arrows.length} connection${arrows.length === 1 ? '' : 's'} across ${nodes.size} nodes`
    if (decisions.length) summary += `, including ${decisions.length} decision${decisions.length === 1 ? '' : 's'}`
  } else {
    // Fall back to an ordered chain over every non-empty line.
    const chain = lines.map((l) => l.text).filter(Boolean)
    for (let i = 1; i < chain.length; i++) {
      nodes.add(idFor(chain[i - 1], used, byLabel))
      nodes.add(idFor(chain[i], used, byLabel))
      arrows.push({ from: chain[i - 1], to: chain[i] })
    }
    if (chain.length) nodes.add(idFor(chain[0], used, byLabel))
    summary = `Chained ${chain.length} step${chain.length === 1 ? '' : 's'} in order`
    if (chain.length < 2) warnings.push('Input described fewer than two steps — emitting a minimal graph.')
  }

  const body: string[] = [`flowchart ${dir}`]
  // Node definitions (label visible, id stable)
  for (const [label, id] of byLabel) {
    const isDecision = decisions.some((d) => d === label)
    body.push(isDecision ? `    ${id}{"${esc(label)}"}` : `    ${id}["${esc(label)}"]`)
  }
  for (const a of arrows) {
    const from = byLabel.get(a.from) ?? slug(a.from, used)
    const to = byLabel.get(a.to) ?? slug(a.to, used)
    body.push(a.label ? `    ${from} -->|"${esc(a.label)}"| ${to}` : `    ${from} --> ${to}`)
  }

  return {
    code: body.join('\n'),
    diagramType: 'flowchart',
    engine: 'local',
    summary,
    stats: stats(nodes.size, arrows.length),
    warnings,
  }
}

/** Sequence diagram from `A -> B: msg`, `A calls B`, actor-prefixed lines. */
function genSequence(prompt: string): GenerateResponse {
  const lines = prompt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const used = newIdCounters()
  const byLabel = newLabelMap()
  const participants: string[] = []
  const messages: string[] = []
  const warnings: string[] = []

  const note = (label: string) => {
    const id = idFor(label, used, byLabel)
    if (!participants.includes(id)) participants.push(id)
    return id
  }

  for (const line of lines) {
    const arrows = parseArrows(line)
    if (arrows.length > 0) {
      const dashed = /-{2,}>|-->/.test(line)
      for (const arrow of arrows) {
        const from = note(arrow.from)
        const to = note(arrow.to)
        const msg = arrow.label ? `: ${esc(arrow.label)}` : ''
        messages.push(`    ${from}${dashed ? '-->>' : '->>'}${to}${msg}`)
      }
      continue
    }
    // `Client sends login request` / `Server returns 200 OK`
    const verb = line.match(/^(.+?)\s+(?:sends?|returns?|replies?\s+with|calls?|invokes?|notifies?)\s+(.+)$/i)
    if (verb) {
      const from = note(verb[1])
      const to = participants.find((p) => p !== from) ?? note('Service')
      messages.push(`    ${from}->>${to}: ${esc(verb[2])}`)
      continue
    }
    // `Actor: action` → message from that actor to the previous one
    const actor = line.match(/^([\w .-]{1,40}?)\s*[:：]\s*(.+)$/)
    if (actor) {
      const from = note(actor[1])
      const prev = participants.filter((p) => p !== from).slice(-1)[0] ?? note('Service')
      messages.push(`    ${from}->>${prev}: ${esc(actor[2])}`)
      continue
    }
    // Free text → relay between the two most recent participants
    if (participants.length >= 2) {
      const [a, b] = [participants[participants.length - 2], participants[participants.length - 1]]
      messages.push(`    ${a}->>${b}: ${esc(line)}`)
    } else {
      const from = note('Client')
      const to = note('Server')
      messages.push(`    ${from}->>${to}: ${esc(line)}`)
    }
  }

  if (messages.length === 0) warnings.push('No messages recognised — add lines like `Client -> Server: request`.')

  const body = ['sequenceDiagram', ...participants.map((p) => `    participant ${p}`), ...messages]
  return {
    code: body.join('\n'),
    diagramType: 'sequence',
    engine: 'local',
    summary: `${participants.length} participants, ${messages.length} message${messages.length === 1 ? '' : 's'}`,
    stats: stats(participants.length, messages.length),
    warnings,
  }
}

/** Class diagram from `A extends B` relations and `A { field: type }` blocks. */
function genClass(prompt: string): GenerateResponse {
  const lines = prompt.split(/\r?\n/)
  const used = newIdCounters()
  const byLabel = newLabelMap()
  const relations: string[] = []
  const members = new Map<string, string[]>()
  const nodes = new Set<string>()
  const warnings: string[] = []

  let openClass: string | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (openClass && /^}$/.test(line)) {
      openClass = null
      continue
    }
    if (openClass) {
      const list = members.get(openClass) ?? []
      list.push(`        ${line.replace(/^\+\s*/, '+').replace(/^-\s*/, '-')}`)
      members.set(openClass, list)
      continue
    }

    const rel = line.match(/^(.+?)\s+(extends|implements|inherits\s+from)\s+(.+)$/i)
    if (rel) {
      const child = idFor(rel[1], used, byLabel)
      const parent = idFor(rel[3], used, byLabel)
      nodes.add(child)
      nodes.add(parent)
      const kind = /implements/i.test(rel[2]) ? '<|..' : '<|--'
      relations.push(`    ${parent} ${kind} ${child}`)
      continue
    }

    const block = line.match(/^(?:class\s+)?([\w ]+?)\s*\{$/)
    if (block) {
      const id = idFor(block[1], used, byLabel)
      nodes.add(id)
      members.set(id, [])
      openClass = id
      continue
    }

    const single = line.match(/^(?:class\s+)?([\w ]+?)\s*[:：]\s*(.+)$/)
    if (single) {
      const id = idFor(single[1], used, byLabel)
      nodes.add(id)
      const list = members.get(id) ?? []
      list.push(`        ${single[2].trim()}`)
      members.set(id, list)
      continue
    }

    // Bare name → standalone class node
    if (/^[\w ]+$/.test(line)) {
      nodes.add(idFor(line, used, byLabel))
    }
  }

  if (nodes.size === 0) warnings.push('No classes recognised — try `Order extends Entity` or `Order { id: uuid }`.')

  const body = ['classDiagram']
  for (const [id, list] of members) {
    if (list.length === 0) continue
    body.push(`    class ${id} {`, ...list, '    }')
  }
  body.push(...relations)

  return {
    code: body.join('\n'),
    diagramType: 'class',
    engine: 'local',
    summary: `${nodes.size} classes, ${relations.length} relationships`,
    stats: stats(nodes.size, relations.length),
    warnings,
  }
}

/** State diagram from `A -> B: event` transitions (incl. `[*]` terminals). */
function genState(prompt: string): GenerateResponse {
  const lines = prompt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const used = newIdCounters()
  const byLabel = newLabelMap()
  const transitions: string[] = []
  const nodes = new Set<string>()
  const warnings: string[] = []

  for (const line of lines) {
    const arrows = parseArrows(line)
    if (arrows.length === 0) continue
    for (const arrow of arrows) {
      const from = arrow.from === '[*]' ? '[*]' : idFor(arrow.from, used, byLabel)
      const to = arrow.to === '[*]' ? '[*]' : idFor(arrow.to, used, byLabel)
      if (from !== '[*]') nodes.add(from)
      if (to !== '[*]') nodes.add(to)
      transitions.push(arrow.label ? `    ${from} --> ${to} : ${esc(arrow.label)}` : `    ${from} --> ${to}`)
    }
  }

  if (transitions.length === 0) {
    warnings.push('No transitions found — write lines like `Draft -> Review : submit`.')
  }

  return {
    code: ['stateDiagram-v2', ...transitions].join('\n'),
    diagramType: 'state',
    engine: 'local',
    summary: `${nodes.size} states, ${transitions.length} transitions`,
    stats: stats(nodes.size, transitions.length),
    warnings,
  }
}

/** ER diagram from `A has many B` phrases and `Table(col: type, ...)` blocks. */
function genEr(prompt: string): GenerateResponse {
  const lines = prompt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const used = newIdCounters()
  const byLabel = newLabelMap()
  const relations: string[] = []
  const entities = new Map<string, string[]>()
  const nodes = new Set<string>()
  const warnings: string[] = []

  for (const line of lines) {
    const table = line.match(/^(?:table\s+)?(\w[\w ]*?)\s*\((.+)\)\s*$/i)
    if (table) {
      const id = idFor(table[1].toUpperCase(), used, byLabel)
      nodes.add(id)
      const cols = table[2].split(',').map((c) => c.trim()).filter(Boolean)
      entities.set(
        id,
        cols.map((c) => {
          const m = c.match(/^(?:(\w+)\s+)?(\w+)\s*(?::\s*(\w+))?$/)
          if (m) {
            const type = m[1] ?? m[3] ?? 'string'
            const name = m[2]
            return `        ${type} ${name}`
          }
          return `        string ${c.replace(/\s+/g, '_')}`
        }),
      )
      continue
    }

    const rel = parseRelationPhrase(line)
    if (rel) {
      const a = idFor(rel.a.toUpperCase(), used, byLabel)
      const b = idFor(rel.b.toUpperCase(), used, byLabel)
      nodes.add(a)
      nodes.add(b)
      const many = /has\s+many|contains|includes/i.test(rel.phrase)
      const belongs = /belongs\s+to|references|links?\s+to/i.test(rel.phrase)
      const cardinality = belongs ? (many ? '}o--o{' : '}o--||') : many ? '||--o{' : '||--||'
      relations.push(`    ${belongs ? b : a} ${cardinality} ${belongs ? a : b} : ${esc(rel.phrase.replace(/\s+/g, '_'))}`)
      continue
    }

    const arrows = parseArrows(line)
    for (const arrow of arrows) {
      const a = idFor(arrow.from.toUpperCase(), used, byLabel)
      const b = idFor(arrow.to.toUpperCase(), used, byLabel)
      nodes.add(a)
      nodes.add(b)
      relations.push(`    ${a} ||--o{ ${b} : ${esc((arrow.label ?? 'has').replace(/\s+/g, '_'))}`)
    }
  }

  if (relations.length === 0 && entities.size === 0) {
    warnings.push('Nothing recognised — try `Customer has many Orders` or `User(id: uuid, name: string)`.')
  }

  const body = ['erDiagram']
  for (const [id, cols] of entities) {
    body.push(`    ${id} {`, ...cols, '    }')
  }
  body.push(...relations)

  return {
    code: body.join('\n'),
    diagramType: 'er',
    engine: 'local',
    summary: `${nodes.size} entities, ${relations.length} relationships`,
    stats: stats(nodes.size, relations.length, entities.size),
    warnings,
  }
}

/** Pie chart from `Label 40%` / `Label: 40` lines. */
function genPie(prompt: string): GenerateResponse {
  const shares = prompt
    .split(/\r?\n/)
    .map((l) => parseShare(l.trim()))
    .filter((s): s is { label: string; value: number } => s !== null)
  const warnings: string[] = []
  if (shares.length === 0) warnings.push('No percentages found — write lines like `Mobile 60%`.')

  const titleMatch = prompt.match(/^(?:chart|title)\s+(?:for\s+)?["']?(.+?)["']?$/im)
  const body = ['pie showData', ...(titleMatch ? [`    title ${esc(titleMatch[1])}`] : [])]
  for (const s of shares) body.push(`    "${esc(s.label)}" : ${s.value}`)

  const total = shares.reduce((a, s) => a + s.value, 0)
  return {
    code: body.join('\n'),
    diagramType: 'pie',
    engine: 'local',
    summary: `${shares.length} slices${total ? `, total ${Math.round(total * 100) / 100}` : ''}`,
    stats: stats(shares.length, 0),
    warnings,
  }
}

/** Gantt from `Task: 2026-01-01, 7d` lines, with optional `section` headers. */
function genGantt(prompt: string): GenerateResponse {
  const lines = prompt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const used = newIdCounters()
  const sections: string[] = []
  const tasks: string[] = []
  const warnings: string[] = []
  let currentSection = 'Work'
  let sectionCount = 0
  let taskCount = 0

  for (const line of lines) {
    const sec = line.match(/^(?:section|phase)\s+(.+)$/i)
    if (sec) {
      currentSection = sec[1].trim()
      sections.push(`    section ${esc(currentSection)}`)
      sectionCount++
      continue
    }
    const task = parseGanttTask(line)
    if (task) {
      const id = slug(task.name, used)
      const parts = [task.name.replace(/[:：]/g, '')]
      parts.push(id)
      if (task.after) parts.push(`after ${slug(task.after, used)}`)
      else if (task.start) parts.push(task.start)
      parts.push(task.duration)
      tasks.push(`    ${parts.join(', ')}`)
      taskCount++
    }
  }

  if (taskCount === 0) warnings.push('No tasks found — write `Task: 2026-01-01, 7d` or `Task: after Design, 5d`.')
  if (sectionCount === 0) sections.push(`    section ${esc(currentSection)}`)

  return {
    code: ['gantt', '    dateFormat YYYY-MM-DD', '    axisFormat %b %d', ...sections, ...tasks].join('\n'),
    diagramType: 'gantt',
    engine: 'local',
    summary: `${taskCount} tasks in ${sectionCount || 1} section${sectionCount === 1 ? '' : 's'}`,
    stats: stats(taskCount, 0, sectionCount),
    warnings,
  }
}

/** Journey from `Task: 5: Role` steps (or `User scores 5: Task`). */
function genJourney(prompt: string): GenerateResponse {
  const lines = prompt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const steps: string[] = []
  const roles = new Set<string>()
  const warnings: string[] = []
  let title = 'User journey'

  for (const line of lines) {
    const t = line.match(/^(?:title|journey)\s+(.+)$/i)
    if (t) {
      title = t[1].trim()
      continue
    }
    const step = parseJourneyStep(line)
    if (step) {
      roles.add(step.role)
      steps.push(`        ${esc(step.task)}: ${step.score}: ${esc(step.role)}`)
    }
  }

  if (steps.length === 0) warnings.push('No steps found — write `Sign up: 4: New user`.')

  return {
    code: ['journey', `    title ${esc(title)}`, `    section Actors`, ...steps].join('\n'),
    diagramType: 'journey',
    engine: 'local',
    summary: `${steps.length} steps, ${roles.size} role${roles.size === 1 ? '' : 's'}`,
    stats: stats(steps.length, 0, roles.size),
    warnings,
  }
}

/** Timeline from `2026: Event A; Event B` / `2026 - Event` lines. */
function genTimeline(prompt: string): GenerateResponse {
  const lines = prompt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const entries: string[] = []
  const warnings: string[] = []
  let title = 'Timeline'

  for (const line of lines) {
    const t = line.match(/^(?:title|timeline)\s+(.+)$/i)
    if (t) {
      title = t[1].trim()
      continue
    }
    const period = line.match(/^([\w .]{1,30}?)\s*[:：\-–]\s*(.+)$/)
    if (period) {
      const events = period[2]
        .split(/[;,]/)
        .map((e) => e.trim())
        .filter(Boolean)
        .map((e) => esc(e))
      if (events.length) entries.push(`    ${esc(period[1].trim())} : ${events.join(' : ')}`)
    }
  }

  if (entries.length === 0) warnings.push('No periods found — write `2026: Launched; Expanded`.')

  return {
    code: ['timeline', `    title ${esc(title)}`, ...entries].join('\n'),
    diagramType: 'timeline',
    engine: 'local',
    summary: `${entries.length} periods`,
    stats: stats(entries.length, 0),
    warnings,
  }
}

/** Mind map from an indented outline / bullet hierarchy. */
function genMindmap(prompt: string): GenerateResponse {
  // Allow a leading `Mind map: <root>` / `Title: <root>` header line.
  const cleaned = prompt.replace(/^(?:mind\s*map|mindmap|title)\s*[:：]\s*/i, '')
  const lines = parseOutline(cleaned)
  const body: string[] = []
  const warnings: string[] = []
  let root: string | null = null
  let edges = 0
  let nodes = 0

  if (lines.length === 0) {
    warnings.push('Empty input — nothing to map.')
  } else {
    root = lines[0].text
    nodes = 1
    body.push(`  root((${esc(root)}))`)
    const stack: { indent: number; depth: number }[] = [{ indent: lines[0].indent, depth: 0 }]

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      while (stack.length > 1 && line.indent <= stack[stack.length - 1].indent) stack.pop()
      const parent = stack[stack.length - 1]
      const depth = parent.depth + 1
      body.push(`${'  '.repeat(depth + 1)}${esc(line.text)}`)
      stack.push({ indent: line.indent, depth })
      nodes++
      edges++
    }
  }

  return {
    code: ['mindmap', ...body].join('\n'),
    diagramType: 'mindmap',
    engine: 'local',
    summary: `${nodes} ideas, ${edges} branches`,
    stats: stats(nodes, edges),
    warnings,
  }
}



/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Structural lint for Mermaid source. Catches the mistakes that make the
 * renderer throw: unknown header, unbalanced brackets/brackets, stray quotes.
 */
export function validateMermaid(code: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const text = (code || '').trim()
  if (!text) return { valid: false, errors: ['Empty diagram.'] }

  const header = text.split(/\r?\n/, 1)[0].trim()
  const known = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|timeline|mindmap|gitGraph)\b/
  if (!known.test(header)) {
    errors.push(`Unknown diagram type: "${header.split(/\s+/)[0]}"`)
  }

  const open = (text.match(/\[/g) ?? []).length
  const close = (text.match(/\]/g) ?? []).length
  if (open !== close) errors.push(`Unbalanced square brackets (${open} open, ${close} close).`)

  const bracesOpen = (text.match(/\{/g) ?? []).length
  const bracesClose = (text.match(/\}/g) ?? []).length
  if (bracesOpen !== bracesClose) errors.push(`Unbalanced braces (${bracesOpen} open, ${bracesClose} close).`)

  const parens = (text.match(/\(/g) ?? []).length - (text.match(/\)/g) ?? []).length
  if (parens !== 0) errors.push('Unbalanced parentheses.')

  const quotes = (text.match(/(?<!\\)"/g) ?? []).length
  if (quotes % 2 !== 0) errors.push('Unbalanced double quotes.')

  if (/^\s*$/m.test(text) && text.split(/\r?\n/).length < 2) errors.push('Diagram has no content lines.')

  return { valid: errors.length === 0, errors }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

const GENERATORS: Record<DiagramType, (prompt: string) => GenerateResponse> = {
  flowchart: genFlowchart,
  sequence: genSequence,
  class: genClass,
  state: genState,
  er: genEr,
  pie: genPie,
  gantt: genGantt,
  journey: genJourney,
  timeline: genTimeline,
  mindmap: genMindmap,
}

export function generateLocal(args: LocalGenerateArgs): GenerateResponse {
  const generator = GENERATORS[args.diagramType] ?? genFlowchart
  const result = generator(args.prompt)

  // Let the caller know when arrow notation shaped the interpretation.
  if (args.diagramType === 'flowchart' && usesArrowNotation(args.prompt)) {
    result.summary += ' (arrow notation detected)'
  }

  const lint = validateMermaid(result.code)
  if (!lint.valid) result.warnings.push(...lint.errors)
  if (!result.warnings.length) result.warnings = EMPTY_WARNINGS
  return result
}
