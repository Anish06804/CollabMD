# CollabMD Progress Tracker

## Legend
- ✅ = Complete and verified
- 🟡 = In progress / integration pending
- 🟠 = Blocked / awaiting dependency
- ❌ = Not started

## Feature Categories

### Editor & Preview
- [x] Dual-pane markdown editor/preview with CodeMirror 6
- [x] Live Mermaid rendering (150ms debounce, SVG, error isolation)
- [x] Sanitized HTML preview (markdown-it + DOMPurify, XSS-safe)
- [x] IDE-like chrome: formatting toolbar, presence bar, status bar
- [x] Formatting toolbar from previous website (Bold, Italic, Strikethrough, H1-H3, lists, task check, link, code block, table) — integrated with CM transactions, Yjs sync, read-only enforcement, keyboard shortcuts (Ctrl+B, Ctrl+I, Ctrl+K)
- [x] Viewing-mode lock (host-controlled editing ⇄ view-only for everyone except owner)

### Real-Time Collaboration
- [x] Yjs CRDT document sync over WebSocket (sub-50ms propagation)
- [x] Live cursors & selections (per-user color/name via Yjs Awareness)
- [x] Server-side read-only enforcement (VIEWER updates dropped per message)
- [x] Graceful persistence (debounced 800ms to Postgres, auto-unload on disconnect)
- [x] Per-message WS read-only: `readOnly = VIEWER || (locked && !OWNER)`
- [x] On unlock: server broadcasts syncStep1 to all sockets for reconciliation
- [x] Owner exempt everywhere (WS + `requireEditor` via `auth.isOwner`)

### Code Execution
- [x] Server-side execution in child processes (10s run / 25s compile timeout)
- [x] Supported languages: JavaScript, TypeScript, C, C++, Fortran, Python, PowerShell
- [x] 100KB output cap, temp-file cleanup with `finally`
- [x] Language runtime probing at startup (runnable badges never lie)
- [x] Language detection: weighted signature scorer + direct hints
- [x] Auto-tagging: running an untagged fence detects its language and writes the tag into the shared doc

### Language Recognition & Library
- [x] ~90-language catalog with id, label, color, extension, aliases, category
- [x] Weighted signature scorer client-side (lib/languageDetect.ts)
- [x] Server-side `POST /api/execute/detect`
- [x] Definitive hints (shebang, `<?php`, `<!DOCTYPE html>`, mermaid/json markers)
- [x] Results ranked with `confidence` and `uncertain` flag
- [x] Searchable dropdown (search id/label/ext/aliases, categories, colored dots, run badges)
- [x] Auto-tagging (writes fence tag into shared doc as conflict-free Yjs insert)

### Mermaid AI Studio
- [x] 10 diagram types × 3 rendering engines (local/llm/local-then-llm)
- [x] Offline `local` rule engine by default (no AI key required)
- [x] Auto-upgrades to `llm` engine if API key added
- [x] Response always reports actual engine used
- [x] Structural validation (`POST /api/ai/mermaid/validate`)
- [x] Generation stats/warnings (node/edge/step counts)
- [x] All 10 types: flowchart, sequence, class, state, er, gantt, pie, journey, timeline, mindmap

### Version History & Snapshots
- [x] Automatic versions after 30s quiet (capped at 100, oldest trimmed)
- [x] Manual version capture (one-click)
- [x] Restore any version into live doc (instant, records as new version)
- [x] Named snapshots: create, list, restore, delete

### Exports
- [x] Markdown download (.md)
- [x] HTML download (self-contained, Mermaid inlined — no CDN needed)
- [x] PDF export (Puppeteer, system Chrome via `PUPPETEER_EXECUTABLE_PATH`; bundled Chrome fallback)

### Rooms & Permissions
- [x] 6-character room codes (unique-checked against DB)
- [x] Permission enum: OWNER / EDITOR / VIEWER
- [x] Room creators are OWNER; new members get `defaultPermission`
- [x] Owner can change member permissions and remove members

### Viewing-Mode Lock (host lock) — Fully Verified
- [x] Backend: schema `Room.locked` + migration `20260930213252_room_viewing_lock`
- [x] Types: `PublicRoom.locked`, `AuthContext.locked`
- [x] `serialize.ts` writes locked flag
- [x] `auth.ts` `requireEditor` → 403 "The host has locked this room to viewing mode"
- [x] `roomService.updateRoom({locked})` + `notifyRoomLockChanged`
- [x] `collaborationRegistry.ts` (`locked` on RoomCollab, seeds `roomMeta` on load, exports `setRoomLock`)
- [x] `websocket/collaboration.ts` (per-message `readOnly = VIEWER || (locked && !OWNER)`, exports `notifyRoomLockChanged` — on unlock sends syncStep1 to all sockets; try/catch around room load)
- [x] Frontend: `Room.tsx` (metaLocked subscription on `doc.getMap('roomMeta')`, `canEdit = permission !== 'VIEWER' && (!locked || isOwner)`, `toggleLock`, owner header toggle button "Editing mode"/"Viewing mode", amber banner, status-bar chip, pane badge "View only · locked")
- [x] `MermaidStudio.tsx` (`canInsert` prop; local renamed `insertReady`)
- [x] Docs updated: README (features, diagram line aligned at 64 chars, Room model row, PATCH row, WS protocol section, testing section), `docs/API.md`, `docs/ARCHITECTURE.md`
- [x] Verification all green: frontend `tsc` clean, `vite build` 14.7s ✓, backend `tsc` emit exit 0 ✓, `ai-test.mjs` **37/37 PASS**, new `lock-test.mjs` **8/8 PASS** (editor Yjs updates dropped while locked, editor version POST → 403, owner → 201, editor PATCH lock → 403, GET reads → 200, re-lock idempotent, cleanup)
- [x] Browser E2E (2 fresh tabs): presence "2 online" Connected; Alice owner toggle → both tabs flip in real time (Alice: banner "you (the host) can still edit", editable=true; Bob: banner "host has locked editing", `contenteditable=false`, badge "View only · locked", Run disabled); unlock → Bob editable again instantly

### Reliability Fixes
- [x] Fixed ghost-user presence caused by missing join authentication token
- [x] Verified multi-tab presence synchronization
- [x] Verified owner permission enforcement

### Fence Regex Root Cause Fix
- [x] `codeBlocks.ts`, `markdown.ts`, backend `exportService.ts` — tolerant fence regexes (accepts optional whitespace + multi-word info strings)
- [x] Status bar + Run Code now work live (verified: Python block at offset 1685 → `EXIT 0`, stdout `5`)

### Documentation
- [x] README.md written and code-accurate (24 endpoints, schema, protocol, constants, scripts)
- [x] docs/API.md code-accurate (16 REST endpoints + WS protocol + error format + viewing mode)
- [x] docs/ARCHITECTURE.md code-accurate (permission table + Viewing Mode section)
- [x] docs/PLANNING.md — project roadmap and completed state
- [x] docs/PROGRESS.md — progress tracking per feature category
- [ ] docs/DEFENSE_QA.md — in progress (below)

### Testing & Reliability
- [x] Frontend: `tsc` clean, `vite build` 14.7s ✓
- [x] Backend: `tsc --noEmit` + emit exit 0 ✓
- [x] `ai-test.mjs` **37/37 PASS** (regression suite)
- [x] `lock-test.mjs` **8/8 PASS** (protocol-level lock regression suite)
- [x] Browser E2E: presence "2 online"; Alice owner toggle → both tabs flip in real time; unlock → Bob editable again
- [x] Judges observe collaboration across multiple laptops (verified)

### Deployment
- [x] Frontend: Vercel (`npm run build` → `dist`)
- [x] Backend: Render / Railway / Fly.io (Node + Express + ws + Prisma)
- [x] Postgres: Neon / Supabase / Render (embedded binary for local verification)
- [x] Puppeteer PDF export: `PUPPETEER_EXECUTABLE_PATH` config, system Chrome

## Recently Completed (This Session)
- Viewing-mode lock: full backend + frontend integration + 8/8 lock-test.mjs + E2E verification + docs updates — all verified green
- Formatting toolbar from previous website: ported to CodeMirror 6, wired with CM transactions + Yjs sync + undo/redo via CM history commands + keyboard shortcuts (Ctrl+B, Ctrl+I, Ctrl+K) + read-only enforcement + mermaid dropdown + table insert + faithful icon set + disabled state when locked/viewing — integrated above editor pane, full-width, matching old-site layout and behavior
- README accuracy verify (24 endpoints, schema, protocol, constants, scripts — all match code)

## Blocked / Waiting
- (none — all features complete, builds green, E2E verified)