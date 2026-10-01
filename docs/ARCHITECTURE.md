# CollabMD Architecture

## System Overview

CollabMD is a real-time collaborative Markdown editor built on a CRDT-based synchronization layer. The system consists of three tiers:

1. **Frontend** — React 19 SPA with CodeMirror 6, Yjs binding, and Mermaid rendering
2. **Backend** — Node.js/Express HTTP API + WebSocket server speaking the Yjs sync protocol
3. **Database** — PostgreSQL via Prisma, storing rooms, members, documents, versions, and snapshots

## Real-Time Synchronization

### Yjs CRDT Document

Each room has a single Yjs `Y.Doc` containing a `Y.Text` named `markdown`. All collaborative editing happens through this shared text type. Yjs guarantees conflict-free merging regardless of edit order.

### WebSocket Protocol

The backend implements the standard y-websocket protocol (sync + awareness) using `y-protocols`:

- **Sync** — `writeSyncStep1` / `readSyncStep1` exchanges state vectors; `readSyncStep2` / `readUpdate` apply incremental updates
- **Awareness** — cursor positions and user presence are broadcast via `y-protocols/awareness`
- **Read-only enforcement** — VIEWER connections receive sync replies but their update messages are dropped server-side; the same drop applies to every non-OWNER connection while the room's viewing-mode lock is on. Read-only is evaluated **per message**, so a host toggle affects already-connected sockets without a reconnect

### Persistence

- **Debounced (800ms)** — Yjs binary state + plain markdown saved to PostgreSQL on every change
- **On disconnect** — immediate flush when the last connection leaves
- **Auto-version** — a `DocumentVersion` row is created after 30s of content quiet
- **Snapshots** — manual named captures stored as `Snapshot` rows

### Reconnection

The `y-websocket` client provider automatically reconnects with exponential backoff (up to 10s). On reconnect, the sync handshake re-establishes state from the server's in-memory document.

## Data Flow

```
User A types → CodeMirror → Y.Text (local) → Yjs update
  → WebSocket → Server Y.Doc → broadcast to User B
  → User B's Y.Text → CodeMirror renders

Server Y.Doc update → debounced 800ms → PostgreSQL (state + content)
                                      → auto-version check
```

## Permission Model

| Permission | Edit | View | Export | Manage members |
|------------|------|------|--------|----------------|
| OWNER      | ✓    | ✓    | ✓      | ✓              |
| EDITOR     | ✓    | ✓    | ✓      | ✗              |
| VIEWER     | ✗    | ✓    | ✓      | ✗              |

Room creators are OWNER. New members get the room's `defaultPermission` (edit/view). Owners can change member permissions and remove members.

### Viewing Mode (host lock)

The owner (host / super-admin of the room) can switch the entire room between **editing** and **viewing** mode via `Room.locked` (toggled with `PATCH /api/rooms/:roomCode { locked: true|false }`):

| While locked | OWNER (host) | EDITOR | VIEWER |
|--------------|--------------|--------|--------|
| Edit document | ✓ | ✗ (dropped server-side) | ✗ |
| Versions/snapshots (write) | ✓ | ✗ `403` | ✗ |
| Read, export, presence, run | ✓ | ✓ | ✓ |

- **Propagation** — the toggle updates `Room.locked`, mirrors the flag into the shared doc's `roomMeta` map (relayed to every connected client instantly), and on unlock the server sends `syncStep1` to all sockets so edits dropped mid-lock are reconciled instead of leaving clients diverged.
- **UI** — a "Viewing mode" banner + status chip appear; non-owners get a read-only editor, disabled Run Code / Studio insert / restore; the host keeps full editing.

## Security

- **XSS prevention** — markdown-it with `html: false` + DOMPurify sanitization; Mermaid with `securityLevel: 'strict'`
- **WebSocket auth** — token-based anonymous identity validated on every upgrade
- **Server-side read-only** — VIEWER updates are dropped at the protocol level
- **Input validation** — Zod schemas on all REST endpoints
