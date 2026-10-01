/**
 * Optional LLM engine for the Mermaid Studio.
 *
 * When an API key is configured (OpenAI, Anthropic, Groq, or any
 * OpenAI-compatible endpoint via AI_BASE_URL) this generates diagrams with a
 * real model. When no key is present — or the call fails for any reason —
 * it returns `null` so the caller falls back to the local parser. The Studio
 * therefore always works, and upgrades itself automatically when configured.
 */

import { config } from '../config.js'
import { validateMermaid, type LocalGenerateArgs } from './mermaidLocal.js'
import type { GenerateResponse } from './mermaidAi.js'

const SYSTEM_PROMPT = `You are a Mermaid diagram generator.
Convert the user's description into valid Mermaid.js source code.

Rules:
- Output ONLY the Mermaid source, starting with the diagram header (e.g. \`flowchart TD\`).
- No markdown fences, no explanations, no commentary.
- Use quoted node labels to avoid syntax errors with special characters.
- Keep node ids short, alphanumeric, and unique.
- If a diagram type is specified, use exactly that type.`

interface Provider {
  name: 'llm'
  model: string
  call: (prompt: string) => Promise<string>
}

/** Pick the configured provider, if any. Returns null when no key is set. */
function selectProvider(): Provider | null {
  const { ai } = config

  if (ai.baseUrl && (ai.openaiApiKey || ai.groqApiKey)) {
    const key = ai.openaiApiKey || ai.groqApiKey
    const model = ai.openaiModel
    return {
      name: 'llm',
      model: `${model} @ ${safeHost(ai.baseUrl)}`,
      call: (prompt) => callOpenAiCompatible(ai.baseUrl!, key, model, prompt),
    }
  }

  if (ai.openaiApiKey) {
    return {
      name: 'llm',
      model: ai.openaiModel,
      call: (prompt) => callOpenAiCompatible('https://api.openai.com/v1', ai.openaiApiKey, ai.openaiModel, prompt),
    }
  }

  if (ai.groqApiKey) {
    return {
      name: 'llm',
      model: ai.groqModel,
      call: (prompt) => callOpenAiCompatible('https://api.groq.com/openai/v1', ai.groqApiKey, ai.groqModel, prompt),
    }
  }

  if (ai.anthropicApiKey) {
    return {
      name: 'llm',
      model: ai.anthropicModel,
      call: (prompt) => callAnthropic(ai.anthropicApiKey, ai.anthropicModel, prompt),
    }
  }

  return null
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'custom'
  }
}

async function callOpenAiCompatible(base: string, key: string, model: string, prompt: string): Promise<string> {
  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM returned no content.')
  return content
}

async function callAnthropic(key: string, model: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
  const text = data.content?.find((c) => c.type === 'text')?.text
  if (!text) throw new Error('LLM returned no content.')
  return text
}

/** Strip accidental markdown fences and surrounding prose from model output. */
function extractMermaid(raw: string): string {
  let text = raw.trim()
  const fenced = text.match(/```(?:mermaid)?\s*([\s\S]*?)```/)
  if (fenced) text = fenced[1].trim()
  // Drop leading explanation lines until a known header appears.
  const lines = text.split(/\r?\n/)
  const headerIdx = lines.findIndex((l) =>
    /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|timeline|mindmap|gitGraph)\b/.test(
      l.trim(),
    ),
  )
  if (headerIdx > 0) text = lines.slice(headerIdx).join('\n')
  return text.trim()
}

/**
 * Attempt LLM generation. Returns `null` when no provider is configured or
 * anything goes wrong, so the caller can fall back to the local parser.
 */
export async function generateWithLlm(
  args: LocalGenerateArgs & { diagramType: GenerateResponse['diagramType'] },
): Promise<GenerateResponse | null> {
  const provider = selectProvider()
  if (!provider) return null

  try {
    const userPrompt = [
      `Diagram type: ${args.diagramType}`,
      args.context?.trim() ? `Document context:\n${args.context.trim()}` : '',
      '',
      'Description:',
      args.prompt,
    ]
      .filter(Boolean)
      .join('\n')

    const raw = await provider.call(userPrompt)
    const code = extractMermaid(raw)

    const lint = validateMermaid(code)
    if (!lint.valid) {
      console.warn(`[ai] LLM output failed validation (${provider.model}):`, lint.errors)
      return null
    }

    const lines = code.split(/\r?\n/).filter((l) => l.trim())
    return {
      code,
      diagramType: args.diagramType,
      engine: 'llm',
      model: provider.model,
      summary: `Generated with ${provider.model}`,
      stats: { nodes: Math.max(1, lines.length - 1), edges: Math.max(0, lines.length - 2) },
      warnings: [],
    }
  } catch (err) {
    console.warn('[ai] LLM generation failed, falling back to local parser:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Report which engine would be used, without making a network call. */
export function describeAiEngine(): { engine: 'llm' | 'local'; model?: string; configured: boolean } {
  const provider = selectProvider()
  if (provider) return { engine: 'llm', model: provider.model, configured: true }
  return { engine: 'local', configured: false }
}
