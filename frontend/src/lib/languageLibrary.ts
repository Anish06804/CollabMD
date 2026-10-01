import { api, type PublicLanguage } from './api'

/**
 * Cached view of the server's language library.
 *
 * The backend probes every runtime on startup, so this list reflects what can
 * ACTUALLY run on the host (no fake "run" buttons for missing interpreters).
 * The cache is filled once per session and refreshed on demand.
 */

let cache: PublicLanguage[] | null = null
let inflight: Promise<PublicLanguage[]> | null = null

export async function loadLanguageLibrary(force = false): Promise<PublicLanguage[]> {
  if (cache && !force) return cache
  if (inflight && !force) return inflight

  inflight = api
    .getLanguageLibrary()
    .then((res) => {
      cache = res.library
      return cache
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}

export function getCachedLibrary(): PublicLanguage[] {
  return cache ?? []
}

/** Is this language runnable on the server right now? */
export function isRunnable(language: string): boolean {
  if (!cache) return false
  const id = language.toLowerCase()
  return cache.some((l) => l.runnable && (l.id === id || l.aliases.includes(id)))
}

/** Resolve a fence tag / alias to the canonical library entry, if any. */
export function findLanguage(id: string): PublicLanguage | null {
  if (!cache) return null
  const key = id.toLowerCase()
  return cache.find((l) => l.id === key || l.aliases.includes(key)) ?? null
}

/** Languages grouped by category, in catalog order, for the selector. */
export function groupByCategory(library: PublicLanguage[]): Array<{ category: string; items: PublicLanguage[] }> {
  const groups = new Map<string, PublicLanguage[]>()
  for (const lang of library) {
    const list = groups.get(lang.category)
    if (list) list.push(lang)
    else groups.set(lang.category, [lang])
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }))
}
