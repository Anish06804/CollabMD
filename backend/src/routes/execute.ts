import { Router } from 'express'
import { z } from 'zod'
import { requireUser } from '../middleware/auth.js'
import { executeCode, getSupportedLanguages, isLanguageSupported } from '../services/executionService.js'
import { getLanguageLibrary } from '../services/languageLibrary.js'
import { detectLanguage } from '../services/languageDetector.js'

export const executeRouter = Router()

executeRouter.use(requireUser)

// GET /api/execute/languages — full library (every language we know about,
// with `runnable: true` only when a working runtime was probed on this host).
executeRouter.get('/languages', async (_req, res, next) => {
  try {
    const library = await getLanguageLibrary()
    const runnable = library.filter((l) => l.runnable).map((l) => l.id)
    res.json({ languages: runnable, library })
  } catch (err) {
    next(err)
  }
})

// POST /api/execute/detect — recognize the language of a code snippet.
executeRouter.post('/detect', (req, res, next) => {
  try {
    const body = z
      .object({
        code: z.string().min(1).max(50_000),
        hint: z.string().max(40).optional(),
      })
      .parse(req.body)

    const result = detectLanguage(body.code, body.hint)
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// POST /api/execute — run code and return output
executeRouter.post('/', async (req, res, next) => {
  try {
    const body = z
      .object({
        code: z.string().min(1, 'Code is required').max(50_000),
        language: z.string().min(1).max(40),
      })
      .parse(req.body)

    if (!(await isLanguageSupported(body.language))) {
      res.status(400).json({
        error: `Unsupported language: ${body.language}`,
        supported: await getSupportedLanguages(),
      })
      return
    }

    const result = await executeCode(body.code, body.language)
    res.json(result)
  } catch (err) {
    next(err)
  }
})
