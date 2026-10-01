import { Router } from 'express'
import { z } from 'zod'
import { requireUser } from '../middleware/auth.js'
import { DIAGRAM_TYPES, generateDiagram } from '../services/mermaidAi.js'
import { validateMermaid } from '../services/mermaidLocal.js'
import { describeAiEngine } from '../services/mermaidLlm.js'

export const aiRouter = Router()

aiRouter.use(requireUser)

const DIAGRAM_TYPE_IDS: [string, ...string[]] = ['auto', ...DIAGRAM_TYPES]

// GET /api/ai/mermaid/engines — which generation engine is active.
aiRouter.get('/mermaid/engines', (_req, res) => {
  res.json(describeAiEngine())
})

// GET /api/ai/mermaid/types — diagram types the Studio can produce.
aiRouter.get('/mermaid/types', (_req, res) => {
  res.json({ types: DIAGRAM_TYPES })
})

// POST /api/ai/mermaid — generate diagram source from a description.
aiRouter.post('/mermaid', async (req, res, next) => {
  try {
    const body = z
      .object({
        prompt: z.string().min(1, 'Describe the diagram you want.').max(8_000),
        type: z.enum(DIAGRAM_TYPE_IDS).optional().default('auto'),
        context: z.string().max(4_000).optional(),
      })
      .parse(req.body)

    const result = await generateDiagram({
      prompt: body.prompt,
      type: body.type as (typeof DIAGRAM_TYPES)[number] | 'auto',
      context: body.context,
    })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// POST /api/ai/mermaid/validate — structural lint for existing Mermaid source.
aiRouter.post('/mermaid/validate', (req, res, next) => {
  try {
    const body = z.object({ code: z.string().min(1).max(50_000) }).parse(req.body)
    res.json(validateMermaid(body.code))
  } catch (err) {
    next(err)
  }
})
