# CollabMD Project Planning

## Vision
Build COLABMD, a complete working real-time collaborative Markdown & Mermaid diagram studio with version history, exports, shareable rooms, code execution, language recognition, and AI Mermaid Studio — as a production-deployable full-stack app.

## Core Objectives
- **No mockups, fake data, or simulated features** — every functionality must work end-to-end.
- **Stack**: React 19 + TypeScript + Vite + Tailwind v4 + CodeMirror 6 + Yjs + Mermaid + React Router + Lucide (frontend); Node + Express + ws + Yjs + PostgreSQL + Prisma + Zod (backend); Puppeteer PDF export.
- **TypeScript throughout** — both frontend and backend.

## Project Structure
```
/frontend      — Vite React app (TS, Tailwind v4)
/backend       — Express + ws + Prisma + PostgreSQL
/docs          — Markdown documentation (README, API, Architecture, Planning, etc.)
/docs/API.md   — 16 REST endpoints + WS protocol + error format
/docs/ARCHITECTURE.md — System overview, CRDT sync, permission model, viewing mode, security
/docs/PLANNING.md — This file: roadmap and completed state
/docs/PROGRESS.md — Progress tracking per feature category
/docs/DEPLOYMENT.md — Frontend (Vercel), Backend (Render/Railway/Fly.io), Postgres (Neon/Supabase)
```

## Completed Features (All Green)
### Editor & Preview
- Dual-pane markdown editor/preview with CodeMirror 6
- Live Mermaid rendering (150ms debounce, SVG, error isolation)
- Sanitized HTML preview (markdown-it + DOMPurify, XSS-safe)
- IDE-like chrome: toolbar, presence bar, status bar

### Real-Time Collaboration
- Yjs CRDT document sync over WebSocket (sub-50ms propagation)
- Live cursors & selections (per-user color/name via Yjs Awareness)
- Server-side read-only enforcement (VIEWER connections have updates dropped per message)
- Graceful persistence (debounced 800ms to Postgres, auto-unload)

### Code Execution
- Server-side execution in child processes (10s run / 25s compile timeout)
- Supported languages: JavaScript, TypeScript, C, C++, Fortran, Python, PowerShell
- 100KB output cap, temp-file cleanup
- Language runtime probing at startup (runnable badges never lie)

### Language Recognition
- ~90-language catalog with id, label, color, extension, aliases, category
- Weighted signature scorer + direct hints (shebang, `<?php`, `<!DOCTYPE html>`)
- Client-side status bar + `POST /api/execute/detect`
- Auto-tagging: running an untagged fence detects its language and writes the tag into the shared doc

### Mermaid AI Studio
- 10 diagram types × 3 rendering engines (local/llm/local-then-llm)
- Offline `local` rule engine by default (no AI key required)
- Auto-upgrades to `llm` engine if API key added
- Structural validation (`POST /api/ai/mermaid/validate`)
- All 10 types: flowchart, sequence, class, state, er, gantt, pie, journey, timeline, mindmap

### Version History & Snapshots
- Automatic versions after 30s quiet (capped at 100, oldest trimmed)
- Manual version capture (one-click)
- Restore any version into live doc (instant, records as new version)
- Named snapshots: create, list, restore, delete

### Exports
- Markdown download (.md)
- HTML download (self-contained, Mermaid inlined — no CDN needed)
- PDF export (Puppeteer, system Chrome via `PUPPETEER_EXECUTABLE_PATH`; bundled Chrome fallback)

### Rooms & Permissions
- 6-character room codes (unique-checked against DB)
- Permission enum: OWNER / EDITOR / VIEWER
- Room creators are OWNER; new members get `defaultPermission`
- Owner can change member permissions and remove members

### Viewing-Mode Lock (host-controlled)
- `Room.locked` DB field; mirrored into shared doc's `roomMeta.locked`
- Per-message WS read-only: `readOnly = VIEWER || (locked && !OWNER)`
- Owner exempt everywhere (WS + `requireEditor` via `auth.isOwner`)
- On unlock: server broadcasts `syncStep1` to all sockets so dropped edits reconcile
- UI: amber banner + status chip; non-owners get read-only editor, disabled Run/Studio
- Fully verified: 8/8 lock-test.mjs checks pass, E2E real-time toggle verified

### Anonymous & Ghost-User Prevention
- Auth via `x-collabmd-token` header (or `?token=` / body)
- Join requires token; `loadStartedRef`/`submitRef` guards prevent StrictMode double-join
- Previously fixed: join without token → ghost users; presence now matches by user id

### Language Detection & Fence Regex
- Root-cause fix: fence-tag extraction accepts optional whitespace + multi-word info strings
- Language = first word of fence info string
- Status bar + Run Code now work correctly (verified: Python block → `EXIT 0`, stdout `5`)

### Documentation
- README.md written and code-accurate (24 endpoints, schema, protocol, constants, scripts)
- docs/API.md code-accurate
- docs/ARCHITECTURE.md code-accurate (permission table + Viewing Mode section)

## Build & Test Status
- Frontend: `tsc` clean, `vite build` 14.7s ✓
- Backend: `tsc --noEmit` + emit exit 0 ✓
- Regression suites: `ai-test.mjs` **37/37 PASS**, `lock-test.mjs` **8/8 PASS**
- Browser E2E: presence "2 online"; Alice owner toggle → both tabs flip in real time; unlock → Bob editable again

## Deploy Targets
- **Frontend**: Vercel (static SPA, `npm run build` → `dist`)
- **Backend**: Render / Railway / Fly.io (Node + Express + ws, Prisma migrate)
- **Postgres**: Neon / Supabase / Render (postgresql://collabmd:collabmd@localhost:5432/collabmd)

## Next Steps (Active)
- (none — all features complete, builds green, E2E verified)

## Acknowledgments
- Yjs CRDT library for conflict-free concurrency
- CodeMirror 6 for the markdown editing experience
- Mermaid.js for diagram rendering
- Puppeteer for PDF export