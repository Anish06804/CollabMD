import 'dotenv/config'

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '',
  isProd: process.env.NODE_ENV === 'production',
  /** Optional AI provider for the Mermaid Studio. Any one of these upgrades
   *  generation from the local parser to a real LLM; all are optional. */
  ai: {
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    groqApiKey: process.env.GROQ_API_KEY || '',
    groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    /** Base URL override for OpenAI-compatible endpoints (Ollama, LM Studio...). */
    baseUrl: process.env.AI_BASE_URL || '',
  },
}
