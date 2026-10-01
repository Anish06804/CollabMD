import { spawn } from 'node:child_process'

/**
 * The full language library: every language COLLABMD knows about (for
 * selection, highlighting and detection), plus — where a real runtime exists
 * on this machine — the commands needed to actually execute it.
 *
 * Runtimes are PROBED at startup instead of assumed, because a binary being
 * on PATH does not mean it works (Windows ships a `python3.exe` Store stub
 * that always fails, for example). Only languages whose probe passes are
 * advertised as runnable.
 */

export interface RunnerSpec {
  /** Command + args used to test the runtime, e.g. `python --version`. */
  probe: { cmd: string; args: string[] }
  /** Additional runtimes that must also be present (e.g. `java` for Kotlin). */
  extraProbe?: Array<{ cmd: string; args: string[] }>
  /** Source file extension written to the temp dir. */
  ext: string
  /** Override the source file name (Java needs `Main.java`). */
  fileName?: string
  /** Argv template for compiling. Placeholders: {file} {out} {dir} */
  compile?: string[]
  /** Command that performs compilation (defaults to probe.cmd). */
  compileCmd?: string
  /** Argv template for running. Placeholders: {file} {out} {dir} */
  run: string[]
  /** Command that performs the run (defaults to probe.cmd). */
  runCmd?: string
}

export interface LanguageSpec {
  id: string
  label: string
  color: string
  /** Canonical file extension (also the fence tag). */
  ext: string
  aliases: string[]
  category: LanguageCategory
  /** Set after probing. */
  runnable: boolean
  /** Runtime version string, when the probe reported one. */
  version?: string
  runner?: RunnerSpec
}

export type LanguageCategory =
  | 'web'
  | 'systems'
  | 'scripting'
  | 'shell'
  | 'jvm'
  | 'functional'
  | 'data'
  | 'config'
  | 'markup'
  | 'hardware'
  | 'other'

const PROBE_TIMEOUT_MS = 4000
const COMPILE_TIMEOUT_MS = 25_000

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

type Row = [id: string, label: string, color: string, ext: string, aliases: string, category: LanguageCategory]

// aliases is a comma separated list (kept compact so the catalog stays readable)
const CATALOG: Row[] = [
  // web
  ['javascript', 'JavaScript', '#f7df1e', 'js', 'js,es6,es2015,node', 'web'],
  ['typescript', 'TypeScript', '#3178c6', 'ts', 'ts', 'web'],
  ['jsx', 'JSX', '#61dafb', 'jsx', 'react', 'web'],
  ['tsx', 'TSX', '#3178c6', 'tsx', 'react-ts', 'web'],
  ['html', 'HTML', '#e34c26', 'html', 'htm,xhtml', 'web'],
  ['css', 'CSS', '#563d7c', 'css', '', 'web'],
  ['scss', 'SCSS', '#cf649a', 'scss', 'sass', 'web'],
  ['less', 'LESS', '#1d3634', 'less', '', 'web'],
  ['vue', 'Vue', '#42b883', 'vue', 'vuejs', 'web'],
  ['svelte', 'Svelte', '#ff3e00', 'svelte', '', 'web'],
  ['php', 'PHP', '#777bb4', 'php', '', 'web'],
  ['ruby', 'Ruby', '#cc342d', 'rb', 'rbx', 'scripting'],
  ['erb', 'ERB', '#cc342d', 'erb', 'ruby-html', 'web'],

  // systems
  ['c', 'C', '#555555', 'c', '', 'systems'],
  ['cpp', 'C++', '#f34b7d', 'cpp', 'cc,cxx,c++,hpp', 'systems'],
  ['csharp', 'C#', '#178600', 'cs', 'c#,dotnet', 'systems'],
  ['rust', 'Rust', '#dea584', 'rs', 'rustlang', 'systems'],
  ['go', 'Go', '#00add8', 'go', 'golang', 'systems'],
  ['zig', 'Zig', '#f7a41d', 'zig', '', 'systems'],
  ['nim', 'Nim', '#ffc200', 'nim', '', 'systems'],
  ['crystal', 'Crystal', '#000100', 'cr', '', 'systems'],
  ['swift', 'Swift', '#F05138', 'swift', '', 'systems'],
  ['dart', 'Dart', '#0175C2', 'dart', '', 'systems'],
  ['objective-c', 'Objective-C', '#438eff', 'm', 'objc,objectivec', 'systems'],
  ['fortran', 'Fortran', '#4d91d7', 'f90', 'f77,f95,fort', 'systems'],
  ['pascal', 'Pascal', '#E3F179', 'pas', 'delphi', 'systems'],
  ['cobol', 'COBOL', '#808000', 'cbl', '', 'systems'],
  ['ada', 'Ada', '#02f171', 'adb', '', 'systems'],

  // scripting
  ['python', 'Python', '#3776ab', 'py', 'python3,py3', 'scripting'],
  ['perl', 'Perl', '#3871A1', 'pl', 'perl6,raku', 'scripting'],
  ['lua', 'Lua', '#000080', 'lua', '', 'scripting'],
  ['r', 'R', '#276DC3', 'r', 'rlang', 'scripting'],
  ['julia', 'Julia', '#9558B2', 'jl', '', 'scripting'],
  ['groovy', 'Groovy', '#4298b8', 'groovy', '', 'scripting'],
  ['tcl', 'Tcl', '#e4cc98', 'tcl', '', 'scripting'],
  ['awk', 'Awk', '#6beb5c', 'awk', 'gawk,mawk', 'scripting'],
  ['autohotkey', 'AutoHotkey', '#334050', 'ahk', '', 'scripting'],
  ['matlab', 'MATLAB', '#e16737', 'm', 'mathematica', 'scripting'],
  ['octave', 'Octave', '#065142', 'octave', '', 'scripting'],

  // shell
  ['bash', 'Bash', '#4eaa25', 'sh', 'shell,bourne', 'shell'],
  ['sh', 'Shell', '#89e051', 'sh', 'sh-session', 'shell'],
  ['zsh', 'Zsh', '#6633cc', 'zsh', '', 'shell'],
  ['fish', 'Fish', '#3abfb3', 'fish', '', 'shell'],
  ['powershell', 'PowerShell', '#012456', 'ps1', 'pwsh,posh', 'shell'],
  ['batch', 'Batch', '#C1F12E', 'bat', 'cmd,batfile,dos', 'shell'],

  // jvm
  ['java', 'Java', '#b07219', 'java', '', 'jvm'],
  ['kotlin', 'Kotlin', '#7F52FF', 'kt', 'kts', 'jvm'],
  ['scala', 'Scala', '#c22d40', 'scala', '', 'jvm'],
  ['clojure', 'Clojure', '#db5855', 'clj', 'cljs,edn', 'jvm'],

  // functional
  ['haskell', 'Haskell', '#5e5086', 'hs', 'ghc', 'functional'],
  ['elixir', 'Elixir', '#4B275F', 'ex', 'exs', 'functional'],
  ['ocaml', 'OCaml', '#ef7a08', 'ml', 'ocaml', 'functional'],
  ['fsharp', 'F#', '#b84138', 'fs', 'f#,fsx,fsharp', 'functional'],
  ['elm', 'Elm', '#60b5cc', 'elm', '', 'functional'],
  ['racket', 'Racket', '#9d5c63', 'rkt', 'scheme', 'functional'],
  ['prolog', 'Prolog', '#74283c', 'prolog', 'swipl', 'functional'],

  // data
  ['sql', 'SQL', '#e38c00', 'sql', 'postgresql,mysql,sqlite', 'data'],
  ['graphql', 'GraphQL', '#e10098', 'graphql', 'gql', 'data'],
  ['protobuf', 'Protobuf', '#0f9d58', 'proto', 'protocolbuffers', 'data'],
  ['json', 'JSON', '#292929', 'json', '', 'data'],
  ['csv', 'CSV', '#8b1a1a', 'csv', '', 'data'],

  // config
  ['yaml', 'YAML', '#cb171e', 'yaml', 'yml', 'config'],
  ['toml', 'TOML', '#9c4221', 'toml', '', 'config'],
  ['xml', 'XML', '#0060ac', 'xml', '', 'config'],
  ['dockerfile', 'Dockerfile', '#2496ED', 'dockerfile', 'docker', 'config'],
  ['makefile', 'Makefile', '#427819', 'mk', 'make,gnumake', 'config'],
  ['cmake', 'CMake', '#064F8C', 'cmake', '', 'config'],
  ['nginx', 'Nginx', '#009639', 'nginx', '', 'config'],
  ['terraform', 'Terraform', '#7B42BC', 'tf', 'hcl,tfvars', 'config'],
  ['ini', 'INI', '#d3d3d3', 'ini', 'env,properties,cfg', 'config'],

  // markup
  ['markdown', 'Markdown', '#083fa1', 'md', 'mdown,mkdn', 'markup'],
  ['mermaid', 'Mermaid', '#ff3670', 'mermaid', '', 'markup'],
  ['latex', 'LaTeX', '#008080', 'tex', 'latex,bib', 'markup'],
  ['restructuredtext', 'reStructuredText', '#3a516f', 'rst', '', 'markup'],

  // hardware
  ['verilog', 'Verilog', '#b3b3b3', 'v', 'systemverilog,sv', 'hardware'],
  ['vhdl', 'VHDL', '#6060a0', 'vhdl', '', 'hardware'],
  ['assembly', 'Assembly', '#6E4C13', 'asm', 'asmx86,nasm', 'hardware'],

  // other
  ['solidity', 'Solidity', '#363636', 'sol', 'solc', 'other'],
  ['wasm', 'WebAssembly', '#654ff0', 'wat', 'wasm,wast', 'other'],
  ['smalltalk', 'Smalltalk', '#586e75', 'st', 'squeak', 'other'],
]

/* ------------------------------------------------------------------ */
/* Runners (only for languages we can genuinely execute)               */
/* ------------------------------------------------------------------ */

const RUNNERS: Record<string, RunnerSpec> = {
  javascript: { probe: { cmd: 'node', args: ['--version'] }, ext: 'js', run: ['{file}'] },
  typescript: {
    probe: { cmd: 'node', args: ['--version'] },
    ext: 'ts',
    run: ['--experimental-strip-types', '{file}'],
  },
  python: { probe: { cmd: 'python', args: ['--version'] }, ext: 'py', run: ['{file}'] },
  ruby: { probe: { cmd: 'ruby', args: ['--version'] }, ext: 'rb', run: ['{file}'] },
  php: { probe: { cmd: 'php', args: ['--version'] }, ext: 'php', run: ['{file}'] },
  perl: { probe: { cmd: 'perl', args: ['-v'] }, ext: 'pl', run: ['{file}'] },
  lua: { probe: { cmd: 'lua', args: ['-v'] }, ext: 'lua', run: ['{file}'] },
  r: { probe: { cmd: 'Rscript', args: ['--version'] }, ext: 'R', run: ['{file}'] },
  julia: { probe: { cmd: 'julia', args: ['--version'] }, ext: 'jl', run: ['{file}'] },

  bash: { probe: { cmd: 'bash', args: ['--version'] }, ext: 'sh', run: ['{file}'] },
  sh: { probe: { cmd: 'sh', args: ['--version'] }, ext: 'sh', run: ['{file}'] },
  zsh: { probe: { cmd: 'zsh', args: ['--version'] }, ext: 'zsh', run: ['{file}'] },
  fish: { probe: { cmd: 'fish', args: ['--version'] }, ext: 'fish', run: ['{file}'] },
  powershell: {
    probe: { cmd: 'powershell', args: ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'] },
    ext: 'ps1',
    // -ExecutionPolicy Bypass: default Windows policy blocks running .ps1 files.
    run: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '{file}'],
  },
  batch: { probe: { cmd: 'cmd', args: ['/?'] }, ext: 'bat', run: ['/c', '{file}'] },

  c: {
    probe: { cmd: 'gcc', args: ['--version'] },
    ext: 'c',
    compile: ['{file}', '-o', '{out}', '-std=c11', '-O1'],
    run: ['{out}'],
    runCmd: '{out}',
  },
  cpp: {
    probe: { cmd: 'g++', args: ['--version'] },
    ext: 'cpp',
    compile: ['{file}', '-o', '{out}', '-std=c++17', '-O1'],
    run: ['{out}'],
    runCmd: '{out}',
  },
  fortran: {
    probe: { cmd: 'gfortran', args: ['--version'] },
    ext: 'f90',
    compile: ['{file}', '-o', '{out}', '-O1'],
    run: ['{out}'],
    runCmd: '{out}',
  },

  go: { probe: { cmd: 'go', args: ['version'] }, ext: 'go', run: ['run', '{file}'] },
  rust: {
    probe: { cmd: 'rustc', args: ['--version'] },
    ext: 'rs',
    compile: ['{file}', '-O', '-o', '{out}'],
    run: ['{out}'],
    runCmd: '{out}',
  },
  zig: { probe: { cmd: 'zig', args: ['version'] }, ext: 'zig', run: ['run', '{file}'] },
  nim: {
    probe: { cmd: 'nim', args: ['--version'] },
    ext: 'nim',
    compile: ['c', '--hints:off', '-o:{out}', '{file}'],
    run: ['{out}'],
    runCmd: '{out}',
  },
  crystal: {
    probe: { cmd: 'crystal', args: ['--version'] },
    ext: 'cr',
    compile: ['build', '{file}', '-o', '{out}'],
    run: ['{out}'],
    runCmd: '{out}',
  },

  java: {
    probe: { cmd: 'javac', args: ['-version'] },
    extraProbe: [{ cmd: 'java', args: ['-version'] }],
    ext: 'java',
    fileName: 'Main.java',
    compile: ['-d', '{dir}', '{file}'],
    run: ['-cp', '{dir}', 'Main'],
    runCmd: 'java',
  },
  kotlin: {
    probe: { cmd: 'kotlinc', args: ['-version'] },
    extraProbe: [{ cmd: 'java', args: ['-version'] }],
    ext: 'kt',
    compile: ['{file}', '-include-runtime', '-d', '{out}.jar'],
    run: ['-jar', '{out}.jar'],
    runCmd: 'java',
  },
  scala: { probe: { cmd: 'scala', args: ['-version'] }, ext: 'scala', run: ['{file}'] },
  clojure: { probe: { cmd: 'clojure', args: ['-h'] }, ext: 'clj', run: ['-M', '{file}'] },

  swift: { probe: { cmd: 'swift', args: ['--version'] }, ext: 'swift', run: ['{file}'] },
  dart: { probe: { cmd: 'dart', args: ['--version'] }, ext: 'dart', run: ['run', '{file}'] },

  haskell: { probe: { cmd: 'ghc', args: ['--version'] }, ext: 'hs', run: ['{file}'], runCmd: 'runghc' },
  elixir: { probe: { cmd: 'elixir', args: ['--version'] }, ext: 'ex', run: ['{file}'] },
  ocaml: { probe: { cmd: 'ocaml', args: ['-version'] }, ext: 'ml', run: ['{file}'] },
  groovy: { probe: { cmd: 'groovy', args: ['-version'] }, ext: 'groovy', run: ['{file}'] },
  octave: { probe: { cmd: 'octave', args: ['--version'] }, ext: 'm', run: ['--no-gui', '{file}'] },
}

/* ------------------------------------------------------------------ */
/* Build the catalog                                                   */
/* ------------------------------------------------------------------ */

function buildCatalog(): LanguageSpec[] {
  return CATALOG.map(([id, label, color, ext, aliases, category]) => {
    const runner = RUNNERS[id]
    return {
      id,
      label,
      color,
      ext,
      aliases: aliases ? aliases.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean) : [],
      category,
      runnable: false,
      runner,
    }
  })
}

export const LANGUAGES: LanguageSpec[] = buildCatalog()

/** Fast id/alias lookup → canonical spec. */
const byId = new Map<string, LanguageSpec>()
for (const lang of LANGUAGES) {
  byId.set(lang.id, lang)
  for (const a of lang.aliases) byId.set(a, lang)
  byId.set(lang.ext, lang)
}

export function resolveLanguage(input: string): LanguageSpec | null {
  if (!input) return null
  return byId.get(input.trim().toLowerCase()) ?? null
}

export function getLanguage(id: string): LanguageSpec | undefined {
  return byId.get(id.toLowerCase())
}

/* ------------------------------------------------------------------ */
/* Runtime probing                                                     */
/* ------------------------------------------------------------------ */

function cleanVersion(raw: string): string {
  const line = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim())
    .find((l) => l.length > 0)
  return line ? line.slice(0, 70) : ''
}

function probeOnce(cmd: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    let settled = false
    let output = ''
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      resolve({ ok, output })
    }
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const timer = setTimeout(() => done(false), PROBE_TIMEOUT_MS)
    child.on('error', () => done(false))
    child.stdout?.on('data', (d: Buffer) => {
      if (output.length < 2000) output += d.toString()
    })
    child.stderr?.on('data', (d: Buffer) => {
      if (output.length < 2000) output += d.toString()
    })
    child.on('close', (code) => done(code === 0))
  })
}

let probePromise: Promise<void> | null = null

/**
 * Probe every runtime referenced by the catalog, in parallel, and mark the
 * languages that actually work as runnable. Memoized — runs once per process.
 */
export function probeRuntimes(): Promise<void> {
  if (probePromise) return probePromise
  probePromise = (async () => {
    const tasks = LANGUAGES.filter((l) => l.runner).map(async (lang) => {
      const runner = lang.runner!
      const primary = await probeOnce(runner.probe.cmd, runner.probe.args)
      if (!primary.ok) return
      if (runner.extraProbe) {
        for (const extra of runner.extraProbe) {
          const res = await probeOnce(extra.cmd, extra.args)
          if (!res.ok) return
        }
      }
      lang.runnable = true
      lang.version = cleanVersion(primary.output) || undefined
    })
    await Promise.all(tasks)
  })().catch(() => {
    /* probing must never break startup */
  })
  return probePromise
}

export interface PublicLanguage {
  id: string
  label: string
  color: string
  ext: string
  aliases: string[]
  category: LanguageCategory
  runnable: boolean
  version?: string
}

export async function getLanguageLibrary(): Promise<PublicLanguage[]> {
  await probeRuntimes()
  return LANGUAGES.map(({ id, label, color, ext, aliases, category, runnable, version }) => ({
    id,
    label,
    color,
    ext,
    aliases,
    category,
    runnable,
    version,
  }))
}

export async function getRunnableLanguages(): Promise<string[]> {
  await probeRuntimes()
  return LANGUAGES.filter((l) => l.runnable).map((l) => l.id)
}

/** Resolve a fence tag / selector value to a runnable language id. */
export async function findRunnable(input: string): Promise<LanguageSpec | null> {
  await probeRuntimes()
  const spec = resolveLanguage(input)
  if (spec && spec.runnable) return spec
  // Alias may map to a non-runnable language; try a runnable sibling by ext.
  if (spec) {
    const sibling = LANGUAGES.find((l) => l.runnable && l.ext === spec.ext)
    if (sibling) return sibling
  }
  return null
}
