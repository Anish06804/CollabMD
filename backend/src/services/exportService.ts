import MarkdownIt from 'markdown-it'
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { prisma } from '../db.js'
import { getLiveRoomDoc } from './collaborationRegistry.js'
import { getDocumentByRoomCode } from './documentService.js'
import { HttpError } from '../types.js'

const md: MarkdownIt = new MarkdownIt({
  html: false, // never emit raw HTML from markdown source — XSS safe
  linkify: true,
  breaks: false,
})

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Extract the source code of every ```mermaid fenced block, in order. */
export function extractMermaidBlocks(markdown: string): string[] {
  const blocks: string[] = []
  const re = /```[ \t]*mermaid\s*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = re.exec(markdown)) !== null) {
    blocks.push(match[1].trim())
  }
  return blocks
}

/** Render markdown to sanitized-ready HTML, replacing mermaid blocks with placeholders. */
function renderMarkdownWithMermaidPlaceholders(markdown: string): { html: string; mermaid: string[] } {
  const mermaid: string[] = []
  // Replace each mermaid fence with a placeholder token that survives markdown rendering.
  const replaced = markdown.replace(/```[ \t]*mermaid\s*\n([\s\S]*?)```/g, (_m, code: string) => {
    mermaid.push(code.trim())
    return `\n\n<div class="mermaid-placeholder" data-mermaid-index="${mermaid.length - 1}"></div>\n\n`
  })
  return { html: md.render(replaced), mermaid }
}

function mermaidInlineScript(): string {
  // Renders every <pre class="mermaid"> in the document, then flags completion
  // so Puppeteer knows when it is safe to print. Errors are rendered inline.
  return `
    window.__mermaidDone = false;
    (async () => {
      try {
        const { mermaid } = window;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' });
        const nodes = Array.from(document.querySelectorAll('pre.mermaid'));
        for (const node of nodes) {
          try {
            const { svg } = await mermaid.render('export-' + Math.random().toString(36).slice(2), node.textContent);
            const wrapper = document.createElement('div');
            wrapper.className = 'mermaid-svg';
            wrapper.innerHTML = svg;
            node.replaceWith(wrapper);
          } catch (err) {
            const errBox = document.createElement('div');
            errBox.className = 'mermaid-error';
            errBox.textContent = 'Mermaid render error: ' + (err && err.message ? err.message : String(err));
            node.replaceWith(errBox);
          }
        }
      } finally {
        window.__mermaidDone = true;
      }
    })();
  `
}

function buildHtmlDocument(title: string, markdown: string): string {
  const { html, mermaid } = renderMarkdownWithMermaidPlaceholders(markdown)
  const mermaidSources = mermaid.map((code) => `<pre class="mermaid">${escapeHtml(code)}</pre>`).join('\n')
  const mermaidScript = readMermaidBundle()

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    background: #0f1117; color: #e6e8ee; margin: 0; padding: 48px 56px;
    line-height: 1.65; max-width: 900px; margin: 0 auto;
  }
  h1, h2, h3, h4 { line-height: 1.25; margin-top: 1.4em; }
  h1 { font-size: 2em; border-bottom: 1px solid #2a2f3a; padding-bottom: .3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #2a2f3a; padding-bottom: .25em; }
  a { color: #58a6ff; }
  code { background: #1c2129; padding: .15em .4em; border-radius: 4px; font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, monospace; font-size: .9em; }
  pre { background: #161b22; border: 1px solid #2a2f3a; border-radius: 8px; padding: 16px; overflow-x: auto; }
  pre code { background: transparent; padding: 0; }
  blockquote { border-left: 4px solid #3b82f6; margin: 0; padding: .2em 1em; color: #9aa4b2; background: #161b22; border-radius: 0 8px 8px 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #2a2f3a; padding: 8px 12px; text-align: left; }
  th { background: #1c2129; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #2a2f3a; }
  .mermaid-svg { text-align: center; margin: 1.5em 0; overflow-x: auto; }
  .mermaid-svg svg { max-width: 100%; }
  pre.mermaid { display: none; }
  .mermaid-error { color: #f87171; background: #1c2129; border: 1px solid #7f1d1d; border-radius: 8px; padding: 12px 16px; font-family: monospace; white-space: pre-wrap; }
</style>
</head>
<body>
${html}
${mermaidSources}
${mermaidScript ? `<script>${mermaidScript}</script>` : '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>'}
<script>${mermaidInlineScript()}</script>
</body>
</html>`
}

let cachedMermaidBundle: string | null = null

function readMermaidBundle(): string {
  if (cachedMermaidBundle !== null) return cachedMermaidBundle
  const candidates = [
    path.join(process.cwd(), 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
    path.join(process.cwd(), '..', 'frontend', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'),
  ]
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cachedMermaidBundle = fs.readFileSync(candidate, 'utf8')
        return cachedMermaidBundle
      }
    } catch {
      // try next candidate
    }
  }
  cachedMermaidBundle = ''
  return cachedMermaidBundle
}

async function getExportContent(roomCode: string): Promise<{ title: string; markdown: string }> {
  const doc = await getDocumentByRoomCode(roomCode)
  if (!doc) throw new HttpError(404, 'Document not found')
  const live = getLiveRoomDoc(roomCode)
  // Prefer the live collaborative content so the export matches the screen.
  const markdown = live ? live.getText('markdown').toString() : doc.content
  const room = await prisma.room.findUnique({ where: { roomCode: roomCode.toUpperCase() } })
  return { title: room?.name ?? 'Untitled', markdown }
}

export async function exportMarkdown(roomCode: string): Promise<Buffer> {
  const { title, markdown } = await getExportContent(roomCode)
  return Buffer.from(`# ${title}\n\n${markdown}`, 'utf8')
}

export async function exportHtml(roomCode: string): Promise<Buffer> {
  const { title, markdown } = await getExportContent(roomCode)
  return Buffer.from(buildHtmlDocument(title, markdown), 'utf8')
}

export async function exportPdf(roomCode: string): Promise<Buffer> {
  const { title, markdown } = await getExportContent(roomCode)
  const html = buildHtmlDocument(title, markdown)

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    ...(config.puppeteerExecutablePath ? { executablePath: config.puppeteerExecutablePath } : {}),
  })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    // Wait until mermaid has finished rendering (or errored) inline.
    await page.waitForFunction('window.__mermaidDone === true', { timeout: 30_000 })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '14mm', right: '14mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
