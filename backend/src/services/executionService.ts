import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from '../types.js'
import {
  findRunnable,
  getRunnableLanguages,
  LANGUAGES,
  probeRuntimes,
  resolveLanguage,
  type LanguageSpec,
} from './languageLibrary.js'

export interface ExecutionResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  language: string
  /** Version of the runtime that executed the code, when known. */
  runtime?: string
  /** True when a compile step ran before execution. */
  compiled?: boolean
}

const RUN_TIMEOUT_MS = 10_000
const COMPILE_TIMEOUT_MS = 25_000
const MAX_OUTPUT = 100_000 // 100KB cap

export async function isLanguageSupported(language: string): Promise<boolean> {
  const spec = await findRunnable(language)
  return spec !== null
}

export async function getSupportedLanguages(): Promise<string[]> {
  return getRunnableLanguages()
}

/** All catalog languages (runnable or not) — used by the selector library. */
export function getAllLanguages() {
  return LANGUAGES
}

interface RunPlan {
  /** Absolute path of the source file to write. */
  filePath: string
  /** Directory holding the source (and, for compiled languages, the binary). */
  dir: string
  compileCmd?: string
  compileArgs?: string[]
  runCmd: string
  runArgs: string[]
}

function fillTemplate(parts: string[], vars: Record<string, string>): string[] {
  return parts.map((part) =>
    part.replace(/\{(file|out|dir)\}/g, (_m, key: string) => vars[key as keyof typeof vars] ?? ''),
  )
}

/** On Windows gcc/g++ emit `out.exe` even when `-o out` was passed. */
function resolveBinary(dir: string, out: string): string {
  const base = path.join(dir, out)
  for (const candidate of [base, `${base}.exe`, `${base}.out`]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return base
}

function runProcess(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false

    const proc = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      windowsHide: true,
    })

    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGKILL')
    }, opts.timeoutMs)

    proc.stdout?.on('data', (data: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += data.toString()
    })
    proc.stderr?.on('data', (data: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += data.toString()
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        stdout,
        stderr: stderr || `Failed to start ${cmd}: ${err.message}`,
        exitCode: 127,
        timedOut: false,
      })
    })

    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: stderr.slice(0, MAX_OUTPUT),
        exitCode: code,
        timedOut,
      })
    })
  })
}

/**
 * Execute code in a child process. Compiled languages (C, C++, Rust, Java,
 * Kotlin, Nim, Crystal, Go via `go run`, ...) run their compile step first and
 * surface compiler diagnostics when it fails.
 */
export async function executeCode(code: string, language: string): Promise<ExecutionResult> {
  await probeRuntimes()

  const spec = await findRunnable(language)
  if (!spec || !spec.runner) {
    const runnable = await getRunnableLanguages()
    throw new HttpError(
      400,
      `Unsupported language: ${language}. Runnable here: ${runnable.join(', ')}`,
    )
  }

  const runner = spec.runner
  const os = await import('node:os')

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'collabmd-exec-'))
  const sourceName = runner.fileName ?? `main.${runner.ext}`
  const filePath = path.join(tmpDir, sourceName)
  const outName = 'program'

  try {
    await fsp.writeFile(filePath, code, 'utf8')

    const vars = { file: filePath, out: path.join(tmpDir, outName), dir: tmpDir }
    const result: ExecutionResult = {
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      language: spec.id,
      runtime: spec.version,
    }

    // ---- optional compile step ----
    if (runner.compile) {
      const compileCmd = runner.compileCmd ?? runner.probe.cmd
      const compileArgs = fillTemplate(runner.compile, vars)
      const compiled = await runProcess(compileCmd, compileArgs, {
        cwd: tmpDir,
        timeoutMs: COMPILE_TIMEOUT_MS,
      })
      result.compiled = true

      if (compiled.exitCode !== 0 || compiled.timedOut) {
        return {
          stdout: compiled.stdout,
          stderr: compiled.stderr || 'Compilation failed.',
          exitCode: compiled.exitCode,
          timedOut: compiled.timedOut,
          language: spec.id,
          runtime: spec.version,
          compiled: true,
        }
      }
      if (compiled.stderr.trim()) {
        // Warnings from the compiler are worth showing even on success.
        result.stderr = compiled.stderr.slice(0, MAX_OUTPUT)
      }
    }

    // ---- run step ----
    // Compiled binaries replace {out} with the resolved executable path.
    const resolvedOut = runner.compile ? resolveBinary(tmpDir, outName) : vars.out
    const runTemplate = runner.run
    const runCmdRaw = runner.runCmd ?? runner.probe.cmd

    const isDirectBinary = runner.runCmd === '{out}' || (runner.compile && runTemplate[0] === '{out}')
    const runCmd = isDirectBinary ? resolvedOut : fillTemplate([runCmdRaw], { ...vars, out: resolvedOut })[0]
    const runArgs = fillTemplate(runTemplate, { ...vars, out: resolvedOut })

    const ran = await runProcess(runCmd, runArgs, {
      cwd: tmpDir,
      timeoutMs: RUN_TIMEOUT_MS,
      env: { NODE_OPTIONS: '--max-old-space-size=128' },
    })

    return {
      stdout: ran.stdout,
      stderr: result.stderr ? `${ran.stderr}${ran.stderr ? '\n' : ''}${result.stderr}`.slice(0, MAX_OUTPUT) : ran.stderr,
      exitCode: ran.exitCode,
      timedOut: ran.timedOut,
      language: spec.id,
      runtime: spec.version,
      compiled: result.compiled ?? false,
    }
  } finally {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  }
}

/** Human-readable summary of a language for the selector tooltip. */
export function describeLanguage(spec: LanguageSpec): string {
  if (!spec.runnable) return `${spec.label} (no runtime installed)`
  return `${spec.label}${spec.version ? ` — ${spec.version}` : ''}`
}
