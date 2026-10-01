import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Search, Play } from 'lucide-react'
import { cn } from '../../lib/utils'
import { loadLanguageLibrary, groupByCategory } from '../../lib/languageLibrary'
import type { PublicLanguage } from '../../lib/api'

interface LanguageSelectorProps {
  value: string
  onChange: (language: string) => void
  disabled?: boolean
}

/** Shown only until the server library loads (one quick request). */
const FALLBACK: PublicLanguage[] = [
  { id: 'javascript', label: 'JavaScript', color: '#f7df1e', ext: 'js', aliases: ['js'], category: 'Web', runnable: true },
  { id: 'typescript', label: 'TypeScript', color: '#3178c6', ext: 'ts', aliases: ['ts'], category: 'Web', runnable: true },
  { id: 'python', label: 'Python', color: '#3776ab', ext: 'py', aliases: [], category: 'Scripting', runnable: true },
  { id: 'mermaid', label: 'Mermaid', color: '#ff3670', ext: 'mmd', aliases: [], category: 'Markup', runnable: false },
  { id: 'json', label: 'JSON', color: '#292929', ext: 'json', aliases: [], category: 'Data', runnable: false },
  { id: 'sql', label: 'SQL', color: '#e38c00', ext: 'sql', aliases: [], category: 'Data', runnable: false },
]

export function LanguageSelector({ value, onChange, disabled }: LanguageSelectorProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [library, setLibrary] = useState<PublicLanguage[]>(FALLBACK)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    loadLanguageLibrary()
      .then((lib) => {
        if (!cancelled && lib.length) setLibrary(lib)
      })
      .catch(() => {
        /* keep the fallback list */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      // Focus after the dropdown paints
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return library
    return library.filter(
      (l) =>
        l.id.includes(q) ||
        l.label.toLowerCase().includes(q) ||
        l.ext.includes(q) ||
        l.aliases.some((a) => a.includes(q)),
    )
  }, [library, query])

  const groups = useMemo(() => groupByCategory(matches), [matches])
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  const current = library.find((l) => l.id === value.toLowerCase())
  const displayLabel = current?.label ?? (value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Auto')

  const commit = (lang: string) => {
    onChange(lang)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = flat[activeIndex]
      if (pick) commit(pick.id)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-200 transition-colors cursor-pointer',
          'hover:bg-slate-700/60 disabled:opacity-40 disabled:cursor-not-allowed',
          open && 'border-blue-500/50 bg-slate-700/60',
        )}
        title="Language of the code block (auto-detected from content)"
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: current?.color ?? '#64748b' }}
        />
        <span className="min-w-0 truncate">{displayLabel}</span>
        {current?.runnable && (
          <span className="flex items-center gap-0.5 rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-400">
            <Play size={8} /> run
          </span>
        )}
        <ChevronDown size={13} className={cn('text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900 shadow-2xl shadow-black/60">
          <div className="flex items-center gap-2 border-b border-slate-800 px-2.5 py-2">
            <Search size={13} className="text-slate-500" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={onKeyDown}
              placeholder={`Search ${library.length} languages…`}
              className="w-full bg-transparent text-xs text-slate-200 placeholder-slate-600 focus:outline-none"
            />
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {flat.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-slate-500">
                No language matches “{query}”
              </div>
            )}

            {groups.map((group) => (
              <div key={group.category}>
                <div className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-slate-600">
                  {group.category}
                </div>
                {group.items.map((lang) => {
                  const index = flat.indexOf(lang)
                  const selected = lang.id === value.toLowerCase()
                  return (
                    <button
                      key={lang.id}
                      type="button"
                      onClick={() => commit(lang.id)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors cursor-pointer',
                        index === activeIndex ? 'bg-slate-800 text-white' : 'text-slate-300',
                        selected && 'text-blue-300',
                      )}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: lang.color }} />
                      <span className="flex-1 truncate">{lang.label}</span>
                      <span className="font-mono text-[10px] text-slate-600">.{lang.ext}</span>
                      {lang.runnable && (
                        <span
                          className="flex items-center gap-0.5 rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase text-emerald-400"
                          title={lang.version ? `Runtime found: ${lang.version}` : 'Executable on this server'}
                        >
                          <Play size={8} /> run
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          <div className="border-t border-slate-800 px-3 py-1.5 text-[10px] text-slate-600">
            {library.filter((l) => l.runnable).length} runnable on this server · arrow keys + Enter
          </div>
        </div>
      )}
    </div>
  )
}
