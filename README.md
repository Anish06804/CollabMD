# CollabMD

**Real-time collaborative Markdown & Mermaid diagram studio** — a full-stack web app where multiple users edit the same document and draw diagrams together, live, with version history, exports, shareable rooms, code execution, and an AI diagram studio.

---

## Table of contents

1. [Features](#features)
2. [Tech stack](#tech-stack)
3. [How it works (architecture)](#how-it-works-architecture)
4. [Project structure](#project-structure)
5. [Data model (Prisma)](#data-model-prisma)
6. [REST API](#rest-api)
7. [WebSocket protocol](#websocket-protocol)
8. [Mermaid Studio AI](#mermaid-studio-ai)
9. [Language recognition & code execution](#language-recognition--code-execution)
10. [Frontend](#frontend)
11. [Quick start](#quick-start)
12. [Scripts](#scripts)
13. [Environment variables](#environment-variables)
14. [Testing](#testing)
15. [Production build](#production-build)
16. [Documentation](#documentation)

---

## Features

### Collaboration
- **Live co-editing** — one shared Yjs CRDT document per room (a single `Y.Text('markdown')`) synced over WebSocket; concurrent edits merge conflict-free with sub-50ms propagation.
- **Live cursors & selections** — every collaborator's caret and selection is broadcast through Yjs Awareness with per-user color and name.
- **Presence bar** — avatars for online/offline members, matched by user id (never by display name), plus an online counter.
- **Connection status** — live `Connected / Connecting / Reconnecting` badge; the client provider auto-reconnects with exponential backoff (`maxBackoffTime` 10s) and re-syncs every `resyncInterval` 10s.
- **Server-side read-only enforcement** — `VIEWER` connections are dropped at the protocol level: the server discards `SyncStep2`/`Update` messages from viewers, so read-only cannot be bypassed from the client.
- **Graceful persistence** — document state is flushed to Postgres 800ms after the last change (`PERSIST_DEBOUNCE_MS`), immediately when the last connection closes, and on `SIGINT`/`SIGTERM` shutdown. Idle rooms unload after a short timeout.

### Editor & preview
- **Dual-pane workspace** — CodeMirror 6 markdown editor (line numbers, folding, bracket matching, search panel, one-dark theme, undo history, tab indentation) beside a live sanitized preview.
- **Live Mermaid** — fenced ` ```mermaid ` blocks render to SVG as you type (150ms debounce, render counter, inline parse errors that never break the rest of the preview). Renders are debounced and id-unique.
- **Sanitized HTML preview** — markdown-it + DOMPurify (raw HTML disabled, `script/style/iframe` etc. forbidden) — XSS safe.
- **IDE-like chrome** — toolbar (Share, Export, History, Diagram Studio, language selector, Run Code), presence bar, and a status bar showing connection, online count, **language detection of the block under the cursor**, save state, and the current version number.
- **Welcome template** — every new room starts with an interactive tour document (mermaid example, runnable JavaScript, how-to).

### Mermaid Studio AI
- **Text → diagram** — describe a diagram in plain language and get valid Mermaid source with a live preview, code tab, copy, and insert-into-document.
- **All 10 diagram types**: `flowchart`, `sequence`, `class`, `state`, `er`, `gantt`, `pie`, `journey`, `timeline`, `mindmap` — or `auto` detection (weighted signature scoring).
- **Two engines, honestly labeled**:
  - `local` — a built-in rule-based parser/generator that works fully **offline** (arrows, relations, groups, decisions, timelines, scores, tasks…).
  - `llm` — automatic upgrade to OpenAI / Anthropic / Groq (or any `AI_BASE_URL` OpenAI-compatible endpoint) when a key is configured; silently falls back to `local` on any error.
  - The UI badge always reports which engine actually ran (`engine`, `model`, `configured` from `GET /api/ai/mermaid/engines`).
- **Structural validation** — `POST /api/ai/mermaid/validate` lints existing Mermaid source (`valid`, `errors[]`) before it ever hits the renderer.
- **Generation stats/warnings** — node/edge/step counts and warnings (e.g. empty sections) returned with every result.

### Language recognition & library
- **Instant detection, both sides** — a weighted signature scorer runs client-side (`lib/languageDetect.ts`) for the status bar and server-side (`POST /api/execute/detect`) for API consumers; definitive hints (shebang, `<?php`, `<!DOCTYPE html>`, mermaid/json markers) win outright; results come back ranked with `confidence` and an `uncertain` flag.
- **~90-language catalog** — every language has id, label, color, extension, aliases, and a category (`web`, `systems`, `scripting`, `shell`, `jvm`, `functional`, `data`, `config`, `markup`, `hardware`, `other`).
- **Runtime probe, not assumptions** — the server probes every interpreter/compiler at startup (4s timeout); `runnable: true` only when a working runtime was actually found, so "run" badges never lie (in this environment: JavaScript, TypeScript, Python, C, C++, Fortran, PowerShell).
- **Auto-tagging** — running an untagged fence detects its language from content and writes the fence tag into the shared document as a conflict-free Yjs insert the whole room sees.
- **Searchable selector** — the language dropdown searches the full library (id/label/ext/aliases), groups by category, shows colored dots, `.ext`, run badges with runtime version, and keyboard navigation (arrows + Enter).

### Code execution
- **Run the block at your cursor** — toolbar button or `Ctrl+Enter`; picks the runnable block containing the cursor, else the nearest runnable one; user's language override wins over the fence tag.
- **Compiled languages** — compile step then run (C, C++, Fortran, TypeScript via `tsc`).
- **Hard limits** — 10s run timeout, 25s compile timeout, 100KB output cap, temp files in a private temp dir with `finally` cleanup; unsupported language → `400` with the supported list.
- **Executor panel** — output (stdout/stderr/exit code/timed-out), rerun, clear, language display.

### Version history & snapshots
- **Automatic versions** — a version is captured after 30s of quiet (`AUTO_VERSION_QUIET_MS`), capped at **100 versions** per document (oldest trimmed).
- **Manual versions** — one-click capture; **restore** any version (restores into the live Yjs doc so connected clients see it instantly, and records the restore as a new version).
- **Named snapshots** — create, list, restore, and delete labeled checkpoints.

### Exports
- **Markdown** — plain `.md` download.
- **HTML** — self-contained: sanitized markdown with **Mermaid inlined** (no CDN needed offline).
- **PDF** — headless Chrome via Puppeteer (system Chrome through `PUPPETEER_EXECUTABLE_PATH`, or bundled), waits for every diagram to finish rendering before printing.

### Rooms & permissions
- **6-character room codes** (unique-checked against the DB) and shareable links.
- **Permissions**: `OWNER` / `EDITOR` / `VIEWER` per member; new link joiners get the room's `defaultPermission` (`edit` or `view`).
- Owner-only management: rename room, change link access, change member permission, remove member.
- **Viewing mode (host lock)** — the owner (super admin of the room) flips the whole room between editing and viewing mode (`Room.locked`): while locked, everyone except the host is read-only — enforced **server-side** (non-owner WebSocket mutations are dropped; editor REST routes return `403 "The host has locked this room to viewing mode"`), with a banner + status chip and disabled editing, Run Code, Studio insert, and restore for non-owners. The host keeps editing; the flag syncs live through the shared document, and unlocking reconciles any keystrokes dropped mid-lock.
- **Anonymous identity** — token-based users stored in `localStorage` (no signup); `create`/`join` reuse an existing identity when a valid token is presented (no ghost users on reload).

---

## Tech stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS v4 (`@tailwindcss/vite`), CodeMirror 6, Yjs + `y-codemirror.next`, `y-websocket` provider, Mermaid 11, React Router 7, Lucide icons, markdown-it + DOMPurify |
| Backend | Node.js 20+, Express 4, `ws` WebSocket server, Yjs + `y-protocols` + `lib0`, Zod validation, TypeScript (ESM, run via `tsx`) |
| Database | PostgreSQL via Prisma ORM (schema + migrations) |
| Export | Puppeteer 23 (headless Chrome) |
| Dev tooling | `concurrently` (root), Vite HMR, `tsx watch` |

---

## How it works (architecture)

```
┌────────── Browser A ──────────┐      ┌────────── Browser B ──────────┐
│ React + CodeMirror (Y.Text)   │      │ React + CodeMirror (Y.Text)   │
│ Awareness: cursors, presence  │      │ Awareness: cursors, presence  │
└───────┬───────────────▲───────┘      └───────┬───────────────▲───────┘
        │ ws /ws/:code │                      │ ws /ws/:code │
        ▼               │                      ▼               │
┌───────────────────────┴──────────────────────┴───────────────┐
│ Express + ws (single process, port 4000)                     │
│  • custom Yjs protocol: syncStep1/2, update, awareness       │
│  • read-only: VIEWER + host-locked non-owners                │
│  • one relay handler per room (no echo, single broadcast)    │
│  • debounced persist (800ms) → content + Yjs binary state    │
│  • auto-version after 30s quiet (max 100)                    │
│  • REST: rooms, documents, versions, snapshots, exports,     │
│          execute (detect/languages/run), ai (mermaid)        │
│  • serves frontend/dist when present (single-server deploy)  │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
                     PostgreSQL (Prisma)
              User · Room · RoomMember · Document
              DocumentVersion · Snapshot
```

- **One room = one in-memory `Y.Doc`** shared by every socket, loaded from `Document.state` (binary Yjs update) with `Document.content` as the plain-markdown mirror.
- Updates flow: client → server applies to the shared doc → single per-room relay broadcasts to every *other* socket (origin excluded) → no echo, no double-apply.
- Restore operations write into the live doc, so history restore is instantly visible to all collaborators.

---

## Project structure

```
collabmd/
├── package.json               # root: concurrently dev/build/start scripts
├── .env.example               # documented env vars (copy into backend/.env)
├── docker-compose.yml         # local PostgreSQL
├── README.md
├── docs/
│   ├── ARCHITECTURE.md        # components, sync protocol, permissions, persistence
│   ├── API.md                 # REST + WebSocket reference
│   └── DEPLOYMENT.md          # Vercel / Render / Railway / Fly.io / Neon guide
├── frontend/                  # React SPA (Vite dev server :5173)
│   ├── index.html
│   ├── vite.config.ts         # @vitejs/plugin-react + @tailwindcss/vite, /api+/ws proxy
│   └── src/
│       ├── main.tsx           # bootstrap
│       ├── App.tsx            # routes: /  •  /room/:roomCode  •  * → /
│       ├── types.ts           # shared API types (Peer, PublicRoom, JoinResponse…)
│       ├── index.css          # Tailwind v4 entry
│       ├── pages/
│       │   ├── Home.tsx       # landing: create-room & join-room flows
│       │   └── Room.tsx       # workspace: toolbar, panes, dialogs, status bar, run, studio
│       ├── hooks/
│       │   ├── useCollaboration.ts   # Yjs doc + WebsocketProvider lifecycle
│       │   ├── usePresence.ts        # remote cursors/users from Awareness
│       │   └── useDocument.ts        # ytext → React content
│       ├── lib/
│       │   ├── api.ts              # fetch client (X-Collabmd-Token), identity helpers, downloadFile
│       │   ├── collab.ts           # createCollabSession (provider params, ws URL)
│       │   ├── codeBlocks.ts       # fence extraction (optional/space-tolerant tags), runnable block picker
│       │   ├── languageDetect.ts   # instant client-side detection (weighted signatures)
│       │   ├── languageLibrary.ts  # cached server library (runnable lookup, grouping)
│       │   ├── mermaid.ts          # initMermaid / renderMermaid
│       │   ├── markdown.ts         # splitMermaidSegments + sanitized render
│       │   └── utils.ts            # cn() class helper
│       └── components/
│           ├── editor/MarkdownEditor.tsx      # CM6 + ySync/yCollab, Ctrl+Enter, cursor broadcast
│           ├── editor/LanguageSelector.tsx    # searchable, categorized, run badges
│           ├── editor/CodeExecutor.tsx        # output panel (auto-run on open)
│           ├── preview/MarkdownPreview.tsx    # segmented markdown/mermaid rendering
│           ├── preview/MermaidBlock.tsx       # debounced SVG per block + inline errors
│           ├── ai/MermaidStudio.tsx           # AI diagram dialog (prompt, type, engine badge)
│           ├── history/VersionHistory.tsx     # versions + snapshots, restore
│           ├── export/ExportDialog.tsx        # MD / HTML / PDF downloads
│           ├── share/ShareDialog.tsx          # invite link, member permissions
│           ├── collaboration/PresenceBar.tsx  # avatars, online/offline (id-matched)
│           ├── collaboration/ConnectionBadge.tsx
│           └── ui/  (Button, Input, Modal, Toaster, Logo, Spinner)
└── backend/                   # Express + WebSocket server (:4000)
    ├── package.json           # dev/build/start, prisma scripts, postinstall generate
    ├── .env.example
    ├── ai-test.mjs            # 37-check regression suite (node ai-test.mjs)
    ├── prisma/
    │   ├── schema.prisma      # data model (below)
    │   └── migrations/
    └── src/
        ├── server.ts          # Express app, routers, static SPA, error handler, ws upgrade, shutdown
        ├── config.ts          # env config incl. optional AI providers
        ├── db.ts              # Prisma client
        ├── express.d.ts       # auth request augmentation
        ├── types.ts           # HttpError, AuthContext, Permission
        ├── middleware/auth.ts # requireUser / requireMember / requireEditor / requireOwner
        ├── routes/
        │   ├── rooms.ts       # create, join, get, patch, members
        │   ├── documents.ts   # content, versions, snapshots
        │   ├── exports.ts     # markdown / html / pdf
        │   ├── execute.ts     # languages, detect, run
        │   └── ai.ts          # engines, types, generate, validate
        ├── websocket/collaboration.ts  # custom permission-aware Yjs protocol
        ├── services/
        │   ├── collaborationRegistry.ts  # per-room Y.Doc, 800ms persist, flush/unload
        │   ├── roomService.ts            # create/join/permissions (identity reuse!)
        │   ├── documentService.ts
        │   ├── versionService.ts         # auto 30s quiet, max 100, restore into live doc
        │   ├── snapshotService.ts
        │   ├── exportService.ts          # MD/HTML (inlined mermaid)/PDF (Puppeteer)
        │   ├── executionService.ts       # compile/run, limits, temp cleanup
        │   ├── languageLibrary.ts        # ~90 langs + runtime probe (4s timeout)
        │   ├── languageDetector.ts       # weighted server-side detection
        │   ├── mermaidAi.ts              # generateDiagram, DIAGRAM_TYPES, engine dispatch
        │   ├── mermaidTypes.ts           # detectDiagramType (weighted rules)
        │   ├── mermaidLocal.ts           # offline generator for 10 types + validateMermaid
        │   └── mermaidLlm.ts             # OpenAI/Anthropic/Groq adapter, engine descriptor
        └── utils/ (roomCode.ts, serialize.ts)
```

---

## Data model (Prisma)

`backend/prisma/schema.prisma`:

| Model | Key fields | Notes |
|---|---|---|
| **Permission** (enum) | `OWNER`, `EDITOR`, `VIEWER` | per-member access |
| **User** | `id`, `token` (unique), `name`, `color?`, timestamps | anonymous token identity |
| **Room** | `id`, `roomCode` (unique, 6 chars), `name`, `defaultPermission` (`"edit"`/`"view"`), `ownerId`, `locked` (host viewing-mode lock) | link access for new members; `locked` forces every non-owner read-only |
| **RoomMember** | `roomId`, `userId`, `permission`, `joinedAt` | `@@unique([roomId, userId])` — no duplicate memberships |
| **Document** | `roomId` (unique), `content` (markdown), `state` (Bytes — Yjs binary), `version` (latest number) | mirror of the live CRDT |
| **DocumentVersion** | `documentId`, `content`, `versionNumber`, `createdById?` | `@@unique([documentId, versionNumber])`, auto-trimmed to 100 |
| **Snapshot** | `documentId`, `name`, `content`, `createdById?` | named checkpoints |

---

## REST API

Base URL: `
         `. Full reference in [`docs/API.md`](docs/API.md).

**Authentication** — every authenticated request needs the user token, accepted from any of:
1. Header `X-Collabmd-Token: <token>` (what the frontend always sends)
2. Query `?token=<token>` (frontend fallback for GETs)
3. Body field `token` (create/join)

**Errors** — JSON `{ "error": string }`; Zod validation failures return `400` with `{ error: "Validation failed", details: [{ path, message }] }`.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | — | `{ ok, time }` liveness check |
| POST | `/api/rooms` | token optional | Create room `{ name, displayName, access: "edit"\|"view", token? }` → `201 { user, room, members, document }` |
| POST | `/api/rooms/join` | token optional | Join `{ roomCode, displayName, token? }` → `{ user, room, members, permission, document }` (reuses identity when token valid; grants `defaultPermission` to new members) |
| GET | `/api/rooms/:roomCode` | member | `{ room, members }` (members ordered by `joinedAt`) |
| PATCH | `/api/rooms/:roomCode` | owner | Rename, change link access, or toggle viewing mode `{ name?, access?, locked? }` → `{ room }` (`locked: true` = host lock; `access` and `defaultPermission` both accepted) |
| PATCH | `/api/rooms/:roomCode/members/:userId` | owner | Change permission `{ permission: "EDITOR"\|"VIEWER" }` → `{ member }` (`OWNER` grant rejected) |
| DELETE | `/api/rooms/:roomCode/members/:userId` | owner | Remove member → `204` (owner cannot be removed) |
| GET | `/api/documents/:roomCode` | member | `{ document }` current content |
| GET | `/api/documents/:roomCode/versions` | member | `{ versions }` history list |
| POST | `/api/documents/:roomCode/versions` | editor+ | Capture version now → `201 { version }` |
| POST | `/api/documents/:roomCode/versions/:id/restore` | editor+ | Restore → `{ ok: true }` (applies to live doc + creates a new version) |
| GET | `/api/documents/:roomCode/snapshots` | member | `{ snapshots }` |
| POST | `/api/documents/:roomCode/snapshots` | editor+ | Create `{ name }` → `201 { snapshot }` |
| POST | `/api/documents/:roomCode/snapshots/:id/restore` | editor+ | Restore → `{ ok: true }` |
| DELETE | `/api/documents/:roomCode/snapshots/:id` | editor+ | Delete → `204` |
| GET | `/api/documents/:roomCode/export/markdown` | member | `document.md` download |
| GET | `/api/documents/:roomCode/export/html` | member | Self-contained `document.html` (Mermaid inlined) |
| GET | `/api/documents/:roomCode/export/pdf` | member | `document.pdf` via Puppeteer (`502` if diagram rendering fails) |
| GET | `/api/execute/languages` | token | `{ languages: runnable[], library: PublicLanguage[] }` — full ~90-lang catalog with probed `runnable` flags |
| POST | `/api/execute/detect` | token | `{ code, hint? }` → ranked `{ candidates: [{ id, confidence }], uncertain }` |
| POST | `/api/execute` | token | `{ code, language }` → `{ stdout, stderr, exitCode, timedOut }` (`400` + `supported` if not runnable) |
| GET | `/api/ai/mermaid/engines` | token | `{ engine: "local"\|"llm", model?, configured }` |
| GET | `/api/ai/mermaid/types` | token | `{ types: DiagramType[] }` (10 types) |
| POST | `/api/ai/mermaid` | token | `{ prompt, type?: "auto"\|DiagramType, context? }` → `{ code, type, detectedType?, engine, stats, warnings, ... }` |
| POST | `/api/ai/mermaid/validate` | token | `{ code }` → `{ valid, errors[] }` |

Middleware chain: `requireUser` (token → User) → `requireMember` (membership → `auth.permission`) → `requireEditor` (blocks `VIEWER`) / `requireOwner`.

Static: when `frontend/dist` exists the same server serves the SPA with history fallback (except `/api` and `/ws`).

---

## WebSocket protocol

**Endpoint:** `ws://<host>/ws/:roomCode?token=<token>`

- **Auth during upgrade** — room must exist; token must resolve to a user; that user must be a member (else close with `4001`-style code). Messages arriving during auth are buffered and replayed (no lost first sync).
- **Messages** (Yjs wire format): `0 = SYNC` (syncStep1 / syncStep2 / update), `1 = AWARENESS`, `3 = QUERY_AWARENESS`.
  - `syncStep1` (read-only safe) is always answered.
  - `syncStep2` and `update` **mutate → dropped for read-only connections**: `VIEWER` always, and every non-`OWNER` connection while the host viewing-mode lock is on (evaluated per message, so a toggle applies to live sockets immediately).
  - Awareness updates are tracked per socket so a disconnect removes exactly that socket's cursors/presence and broadcasts the removal.
- **Viewing-mode flag** — the lock rides the shared doc (`roomMeta.locked`, written server-side) so every client flips UI state instantly; on unlock the server broadcasts `syncStep1` to all sockets and clients reply with their diff, reconciling any edits dropped mid-lock (no divergence).
- **Broadcast** — one relay handler per room; the originating socket is excluded (no echo); each update is relayed exactly once.
- **Client** — `y-websocket` `WebsocketProvider` with `resyncInterval: 10_000`, `maxBackoffTime: 10_000`, automatic reconnection; awareness carries `{ id, name, color }` + `{ anchor, head }` cursor (relative positions, survive edits).
- **Persistence** — every doc update schedules an 800ms debounce → writes `content` + Yjs binary `state`; flushed immediately when the last socket closes, on room unload, and on process shutdown; auto-versioning runs after 30s quiet.

---

## Mermaid Studio AI

**Endpoint:** `POST /api/ai/mermaid` — `{ prompt: string(1..8000), type?: "auto" | flowchart | sequence | class | state | er | gantt | pie | journey | timeline | mindmap (default "auto"), context?: string(≤4000) }`

**Pipeline** (`services/mermaidAi.ts`):
1. Resolve diagram type — explicit `type`, else `detectDiagramType()` weighted rule scoring (gantt/pie/sequence/class/state/er/journey/timeline/mindmap/flowchart; flowchart arrow counts win ties).
2. **Engine selection** — `llm` only when a provider key exists (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, or `AI_BASE_URL`); any failure falls back to `local`. Response always states the engine that actually ran.
3. **Local engine** (`mermaidLocal.ts`) — deterministic rule-based generation for all 10 types: arrow chains (`A -> B -> C` split into pairs), piped/dashed labels, decisions, relations (`has many`, `contains`, …), gantt task syntax, journey scores, timeline years, mindmap outlines; ids generated from slugs, labels escaped, multi-arrow lines preserved.
4. **LLM engine** (`mermaidLlm.ts`) — provider-specific request builders, code extraction from replies (fence stripping), same response shape.
5. Validate + count stats; warnings for suspicious inputs.

**UI** (`components/ai/MermaidStudio.tsx`) — example chips, type select, engine badge, `Ctrl+Enter` to generate, Preview/Code tabs with debounced live rendering, stats/warnings footer, Copy, and **Insert into document** (writes a ` ```mermaid ` block at the cursor via Yjs).

---

## Language recognition & code execution

**Detection** (two implementations, same algorithm):
- Direct hints win outright: shebang (`#!/usr/bin/env …`), `<?php`, `<!DOCTYPE html>`, mermaid/json markers.
- Otherwise weighted signature scoring (regex × weight × occurrence cap) over per-language signatures; result = ranked candidates with `confidence = top / total`, `uncertain` when the total signal is weak or the top two are too close.
- Client: status bar chip (shows `detected NN%` for untagged blocks, solid label for tagged ones) and untagged-run auto-tagging. Server: `POST /api/execute/detect` (code ≤ 50KB).

**Library** (`GET /api/execute/languages`):
- ~90 entries: `{ id, label, color, ext, aliases, category, runnable, version? }`.
- `runnable` comes from a parallel startup probe (`PROBE_TIMEOUT_MS` 4000) of each runner's real binary — e.g. `python --version`, `gcc --version`. Compile-based runners (C/C++/Fortran/TypeScript) probe the compiler.
- Categories: `web`, `systems`, `scripting`, `shell`, `jvm`, `functional`, `data`, `config`, `markup`, `hardware`, `other`.

**Execution** (`POST /api/execute`):
- Writes to a temp file, runs the probed binary (PowerShell: `-NoProfile -ExecutionPolicy Bypass -File`), compiled languages run a compile step first (25s) then the binary (10s).
- Output capped at 100KB/stream; result `{ stdout, stderr, exitCode, timedOut }`; temp dir removed in `finally`.
- `400 { error, supported }` for non-runnable languages.

**Frontend run flow:** `Ctrl+Enter`/Run Code → fence extraction (tags optional and space-tolerant: ` ``` `, ` ```js `, ` ``` python `) → runnable block at/near cursor → if untagged, detect + insert tag into the shared doc → `POST /api/execute` → CodeExecutor panel.

---

## Frontend

**Routes** (`App.tsx`): `/` (Home) · `/room/:roomCode` (Room) · `*` → `/`.

**Home** — landing page with hero, create-room form (workspace name, display name, access `edit`/`view`) and join-by-code form (room code + display name); identity persisted to `localStorage` (`collabmd_token`, `collabmd_name`).

**Room** — full workspace:
- **Toolbar**: Share (invite link + member permissions), Export (MD/HTML/PDF), History (versions + snapshots), Diagram Studio (AI), language selector, Run Code.
- **Panes**: editor (left) / preview (right).
- **Dialogs**: `ShareDialog`, `ExportDialog`, `VersionHistory`, `MermaidStudio`.
- **Status bar**: connection state, online count, **detected language chip** (color dot + confidence), save indicator, version number.
- **Join gate**: when no token, a display-name gate joins the room and issues the identity.

**Key hooks**
- `useCollaboration(roomCode, token|null)` — creates the Yjs doc + provider, exposes `session` (`doc`, `provider`, `ytext`) and connection `status`; disabled until the room is ready.
- `useDocument(ytext)` — current markdown `content`.
- `usePresence(awareness, selfClientId)` — remote peers (skip self), each `{ clientId, user: { id?, name, color }, cursor }`.

**Editor** — CodeMirror 6 extensions: line numbers, active-line, history, fold gutter, search panel, markdown language, one-dark, bracket matching, indent-on-input, `ySync` + `yCollab` (awareness cursors), keymap incl. `Ctrl+Enter` → `collabmd:run-code`, tab = indent.

---

## Quick start

**Requirements:** Node.js 20+, PostgreSQL 14+ (or Docker for `docker-compose.yml`).

```bash
# 1. Install everything (root + backend + frontend)
npm run install:all

# 2. Configure environment
cp .env.example backend/.env     # set DATABASE_URL, PORT, FRONTEND_URL…

# 3. Create the schema
npm --prefix backend run prisma:migrate

# 4. Run backend (:4000) + frontend (:5173) together
npm run dev
```

Open **http://localhost:5173** → create a room → copy the link into a second browser or laptop → edit and watch changes sync.

> **Windows notes:** use `npm.cmd` if your shell blocks `npm.ps1`; approve postinstall scripts if prompted (`npm install-scripts approve`); start PostgreSQL before the backend.

---

## Scripts

| Where | Command | What it does |
|---|---|---|
| root | `npm run install:all` | installs backend + frontend dependencies |
| root | `npm run dev` | `concurrently` → backend (`tsx watch`) + frontend (`vite`) |
| root | `npm run build` | backend `tsc` → `dist/` + frontend `tsc -b && vite build` → `dist/` |
| root | `npm start` | runs the built backend (API + WS + static frontend if built) |
| backend | `npm run dev` | `tsx watch src/server.ts` |
| backend | `npm run build` / `start` | compile to `dist/` / run `dist/server.js` |
| backend | `npm run prisma:generate` | regenerate Prisma client (also runs on `postinstall`) |
| backend | `npm run prisma:migrate` | create/apply migrations (`prisma migrate dev`) |
| backend | `npm run prisma:deploy` | apply migrations in production (`prisma migrate deploy`) |
| backend | `node ai-test.mjs` | 37-check regression suite |
| frontend | `npm run dev` | Vite dev server (proxies `/api` + `/ws`) |
| frontend | `npm run build` | typecheck + production bundle |
| frontend | `npm run preview` | preview the production bundle |

---

## Environment variables

Copy `.env.example` → `backend/.env`:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `PORT` | — | `4000` | HTTP + WebSocket port |
| `FRONTEND_URL` | — | `http://localhost:5173` | CORS origin(s), comma-separated; `*` allows any |
| `NODE_ENV` | — | — | `production` enables prod behavior |
| `PUPPETEER_EXECUTABLE_PATH` | — | bundled Chrome | System Chrome/Chromium for PDF export |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | optional | `gpt-4o-mini` | Mermaid Studio LLM engine (OpenAI) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | optional | `claude-sonnet-4-5` | …or Anthropic |
| `GROQ_API_KEY` / `GROQ_MODEL` | optional | `llama-3.3-70b-versatile` | …or Groq |
| `AI_BASE_URL` | optional | — | Any OpenAI-compatible endpoint |

No AI key → the Studio runs on the built-in **local** engine and says so.

---

## Testing

```bash
cd backend
node ai-test.mjs
```

**37 checks**, covering:
- engines & diagram-type endpoints
- 16 generation cases across all 10 diagram types (incl. 2 mindmaps) + 5 auto-detect cases
- 3 validation cases + auth error paths
- language library (≥60 languages, `runnable` flags match the real probe — e.g. Windows `python3.exe` Store stub correctly *not* runnable)
- 18/18 language-detection cases
- real execution of JavaScript, Python, C, C++, TypeScript, PowerShell + unsupported-language rejection

### Viewing-mode lock suite

```bash
node lock-test.mjs
```

**8 protocol-level checks** against a running server (uses the local `CYNATE` test room with its Alice/Bob members): editor Yjs updates dropped while locked, owner updates accepted while locked, editor version-create → `403`, owner version-create → `201`, editor lock-toggle → `403`, reads stay `200`, lock re-set idempotent, and content cleanup.

---

## Production build

```bash
npm run build                                  # backend dist/ + frontend dist/
npm --prefix backend run prisma:deploy         # apply migrations
NODE_ENV=production npm start                  # single server: API + WS + static SPA
```

The backend automatically serves `frontend/dist` when present — one process, one port. Scaling out and hosting recipes (Vercel frontend + Render/Railway/Fly.io backend + Neon/Supabase Postgres, WebSocket configuration, env vars, health checks) are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). `docker-compose.yml` provides local Postgres.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, sync protocol, permissions, persistence & recovery
- [`docs/API.md`](docs/API.md) — complete REST + WebSocket reference
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — hosting & scaling guide

---

## License

MIT
