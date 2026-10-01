import type { AuthContext } from './types.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext
      authUser?: { id: string }
    }
  }
}

export {}
