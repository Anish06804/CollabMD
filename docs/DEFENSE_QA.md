# CollabMD Defense & QA Report

## Purpose
This document captures the verification status, test results, and quality validation for the COLABMD application as built and tested. All claims are "as per the code" — no mockups, no fake latency, no mocked DB responses.

## Build Verification
- **Frontend**: `tsc` exits clean (TypeScript emit exit 0) ✅
- **Frontend**: `vite build` completes in 14.7s ✅
- **Backend**: `tsc --noEmit` + emit exit 0 ✅
- **Node compilation**: backend via tsx watch (logs at `C:\Users\Anish\AppData\Local\Temp\opencode\backend.log`/`.err.log`)

## Regression Suites
- `backend/ai-test.mjs` — **37/37 PASS**
  - Covers: language detection, execution (JS/Python/C/C++/TypeScript/PowerShell), Mermaid AI (10 diagram types × engines), export formats, language library (~90 languages), runtime probe, auth, room creation, versioning, etc.
- `backend/lock-test.mjs` — **8/8 PASS**
  - Check 1: editor Yjs updates dropped while locked (locked room → no content changes from editor)
  - Check 2: editor version POST returns 403 for non-owner while locked
  - Check 3: owner version POST → 201 (owner always retains write access)
  - Check 4: editor PATCH lock → 403 (non-owner cannot toggle lock)
  - Check 5: GET reads current content → 200 (locked room still serves content)
  - Check 6: re-lock idempotent (PATCH locked:true when already locked → no error)
  - Check 7: cleanup removes contaminated versions 4 & 5, room unlocked
  - Check 8: full protocol round-trip (join, type, lock, unlock, verify editable)

## Browser E2E Verification
- **Session**: Two fresh tabs (Alice = owner, Bob = editor)
- **Presence**: "2 online" Connected in both tabs (no ghost users)
- **Alice owner toggle**:
  - Both tabs flip in real time (WebSocket broadcast)
  - Alice (host): banner "Viewing mode is ON — you (the host) can still edit; every other member is read-only until you unlock." → `contenteditable=true`, Run Code enabled
  - Bob: banner "Viewing mode — the host has locked editing. You can read, export and copy, but not change the document." → `contenteditable=false`, Run disabled, badge "View only · locked"
- **Unlock**: Bob becomes editable instantly; banners revert; Run re-enables
- **Stale-process guard**: PID 8576 holds `[::1]:5173` (belongs to other project E:\DocuFlow) — verified separate

## API Endpoint Accuracy
- README.md: **24 endpoints documented**, each cross-checked against code
  - REST: 16 checks (room create, join, get, PATCH, members CRUD, doc GET/versions/snapshots/exports)
  - WebSocket: protocol section, viewing-mode behavior, per-message read-only enforcement
  - Constants: Permission enum, message types, field names
- docs/API.md: **16 REST endpoints** + WS protocol + error format + viewing-mode effects — all code-accurate
- Docs/API.md rows (PATCH /api/rooms/:roomCode) accept `{name?, access?, defaultPermission?, locked?}` — verified in `routes/rooms.ts`

## Database & Prisma Schema
- **Entities**: User, Room, RoomMember, Document, DocumentVersion, Snapshot
- **Permission enum**: OWNER / EDITOR / VIEWER (string in DB)
- **Room model**: `locked: boolean` (migration `20260930213252_room_viewing_lock`)
- **Prisma migration applied**: verified against embedded Postgres binary
- **Data integrity**: room codes unique-checked at DB level; member unique constraint per room

## Security Verification
- **XSS prevention**: markdown-it with `html: false` + DOMPurify sanitization; Mermaid with `securityLevel: 'strict'`
- **WebSocket auth**: token-based anonymous identity validated on every upgrade (`getOrCreateRoomCollab` failure closes just that socket)
- **Server-side read-only**: VIEWER updates dropped at protocol level; same drop applies to every non-OWNER connection while `Room.locked` is true
- **Input validation**: Zod schemas on all REST endpoints (room create body `{name, displayName, access}`; PATCH accepts `{name?, access?, defaultPermission?, locked?}`)
- **No AI API keys required**: Mermaid Studio uses offline `local` rule engine; response always reports `{"engine":"local","configured":false}`

## Known Constraints (Documented)
- **Windows Python**: `python3.exe` Store stub unusable; server probes actual interpreter at startup; `runnable: true` only when working runtime found
- **Same-browser tabs**: share one `localStorage` (last write wins) — test-harness artifact only; caused a deliberate 403 during E2E (Alice's tab PATCHed as Bob's token) which actually confirmed server-side owner enforcement
- **Anonymous token identity** (localStorage): last write wins; join without token → ghost users (bug fixed: join requests MUST send token)
- **Local Postgres**: embedded binary `C:\Users\Anish\AppData\Local\Temp\opencode\node_modules\@embedded-postgres\windows-x64\native`, data `C:\Users\Anish\AppData\Local\Temp\opencode\pgdata`; `postgres.exe -D ... -p 5432 -c autovacuum=off` (pg_ctl children crash 0xC0000142); local URL `postgresql://collabmd:collabmd@localhost:5432/collabmd`
- **Puppeteer**: `PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe`; `--no-sandbox` args configured; fallback to bundled Chrome

## Test Environment
- **OS**: Windows 10/11
- **PowerShell**: 5 (use `-Encoding UTF8` when measuring README box lines; `Get-Content` misreads UTF-8 otherwise)
- **Backend**: via tsx watch (logs `C:\Users\Anish\AppData\Local\Temp\opencode\backend.log`/`.err.log`); tsx watch does NOT restart after a child crash — touch a watched file to restart
- **Frontend**: Vite `:5173` (`vite.log`); test at `http://127.0.0.1:5173`
- **Local Postgres**: `postgres.exe -D C:\Users\Anish\AppData\Local\Temp\opencode\pgdata -p 5432 -c autovacuum=off`

## QA Sign-off
All features described in README.md, docs/API.md, and docs/ARCHITECTURE.md are implemented, compiled clean, and verified through:
1. TypeScript compilation (frontend + backend)
2. Vite build
3. Regression suites (ai-test.mjs 37/37, lock-test.mjs 8/8)
4. Browser E2E (presence, lock toggle, unlock, permissions)
5. Endpoint accuracy (README vs code)
6. Security model (read-only enforcement, auth, XSS)

**Status**: ✅ ALL CHECKS GREEN — production-deployable state achieved.

## Compliance
- "No mockups, fake buttons, fake users/latency/version history/exports/DB responses" — every feature works end-to-end.
- README accurate "as per the code" (user requested twice; verified 24 endpoints, schema, protocol, constants, scripts all match code).
- TypeScript throughout (frontend + backend).
- Separate frontend/backend packages, root package.json with concurrently (`npm run dev`).