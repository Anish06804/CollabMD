# CollabMD API Reference

## Authentication

All API requests require a token. The token is obtained when creating or joining a room and stored in `localStorage`. Pass it via:

- Query parameter: `?token=<uuid>`
- Header: `X-Collabmd-Token: <uuid>`

## REST Endpoints

### Rooms

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/rooms` | Create a new room |
| POST | `/api/rooms/join` | Join an existing room |
| GET | `/api/rooms/:roomCode` | Get room details + members |
| PATCH | `/api/rooms/:roomCode` | Update room: `name`, `access`, or `locked` — the host viewing-mode toggle (owner only) |
| PATCH | `/api/rooms/:roomCode/members/:userId` | Change member permission (owner) |
| DELETE | `/api/rooms/:roomCode/members/:userId` | Remove member (owner) |

### Documents

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/documents/:roomCode` | Get current document |
| GET | `/api/documents/:roomCode/versions` | List version history |
| POST | `/api/documents/:roomCode/versions` | Capture a version now |
| POST | `/api/documents/:roomCode/versions/:id/restore` | Restore a version |
| GET | `/api/documents/:roomCode/snapshots` | List snapshots |
| POST | `/api/documents/:roomCode/snapshots` | Create a snapshot |
| POST | `/api/documents/:roomCode/snapshots/:id/restore` | Restore a snapshot |
| DELETE | `/api/documents/:roomCode/snapshots/:id` | Delete a snapshot |

### Exports

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/documents/:roomCode/export/markdown` | Download as .md |
| GET | `/api/documents/:roomCode/export/html` | Download as self-contained .html |
| GET | `/api/documents/:roomCode/export/pdf` | Download as .pdf |

## WebSocket

Connect to `ws://<host>/ws/:roomCode?token=<token>`

The server speaks the standard y-websocket protocol (message types: sync=0, awareness=1, queryAwareness=3). Use the `y-websocket` client library for a ready-made provider.

**Viewing mode (host lock):** while `Room.locked` is true, sync messages that would mutate the document (`syncStep2`/`update`) are dropped for every connection whose permission is not `OWNER` — enforced per message, so a lock toggle applies to live sockets immediately. On unlock the server sends `syncStep1` to each socket; clients answer with their diff, reconciling any edits that were dropped mid-lock. The flag itself rides the shared doc (`roomMeta.locked`) so every client switches UI state in real time.

**Locked-room REST effects:** `POST` version/snapshot routes (editor+) return `403 "The host has locked this room to viewing mode"` for non-owners; reads (GET) stay open for everyone.

## Error Format

```json
{
  "error": "Human-readable error message"
}
```

Status codes: 400 (validation), 401 (unauthenticated), 403 (forbidden), 404 (not found), 500 (server error).
