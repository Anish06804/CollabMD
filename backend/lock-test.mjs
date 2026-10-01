/**
 * Viewing-mode lock verification (protocol level, bypasses the UI).
 *
 * While the room is LOCKED:
 *   1. an EDITOR (Bob) socket pushing Yjs updates  -> server must DROP them
 *   2. the OWNER (Alice) socket pushing updates    -> server must ACCEPT them
 *   3. REST: Bob cannot create versions (403), Alice can (201)
 *   4. REST: Bob cannot PATCH the room (403, not owner)
 * Then the marker inserted by Alice is removed so the document stays clean.
 */
import { WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const BASE = 'http://127.0.0.1:4000'
const WS = 'ws://127.0.0.1:4000'
const ROOM = 'CYNATE'
const ALICE = '6953e43a-9310-4621-bc2a-6e7be9b7a2a2'
const BOB = '13d35e89-1eb1-4254-aacf-fe60e4c5a66f'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc()
    const ws = new WebSocket(`${WS}/ws/${ROOM}?token=${token}`)
    let synced = false
    const ready = () => { if (!synced) { synced = true; resolve({ doc, ws }) } }
    const timer = setTimeout(() => reject(new Error('sync timeout')), 8000)

    ws.on('open', () => {
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, 0) // MESSAGE_SYNC
      syncProtocol.writeSyncStep1(enc, doc)
      ws.send(encoding.toUint8Array(enc))
    })
    ws.on('error', (e) => reject(e))
    ws.on('message', (buf) => {
      const dec = decoding.createDecoder(new Uint8Array(buf))
      const type = decoding.readVarUint(dec)
      if (type === 0) {
        const inner = decoding.readVarUint(dec)
        if (inner === syncProtocol.messageYjsSyncStep2) {
          syncProtocol.readSyncStep2(dec, doc, 'server')
          clearTimeout(timer)
          ready()
        } else if (inner === syncProtocol.messageYjsUpdate) {
          syncProtocol.readUpdate(dec, doc, 'server')
        } else if (inner === syncProtocol.messageYjsSyncStep1) {
          const enc = encoding.createEncoder()
          encoding.writeVarUint(enc, 0)
          syncProtocol.writeSyncStep2(enc, doc)
          if (ws.readyState === WebSocket.OPEN) ws.send(encoding.toUint8Array(enc))
        }
      }
      // awareness (1) / query-awareness (3): irrelevant for this test
    })
    doc.on('update', (update, origin) => {
      if (origin === 'server') return // don't echo server-applied changes back
      if (ws.readyState !== WebSocket.OPEN) return
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, 0)
      syncProtocol.writeUpdate(enc, update)
      ws.send(encoding.toUint8Array(enc))
    })
  })
}

async function serverContent() {
  const res = await fetch(`${BASE}/api/documents/${ROOM}?token=${BOB}`)
  const data = await res.json()
  return data.document.content
}

async function rest(path, token, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'x-collabmd-token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let payload = null
  try { payload = await res.json() } catch { /* no body */ }
  return { status: res.status, payload }
}

// --- 1. editor socket cannot mutate while locked -------------------------
const bob = await connect(BOB)
const bobText = bob.doc.getText('markdown')
bobText.insert(bobText.length, '\nLOCKTEST-BOB-EXTRA')
await sleep(1200)
const afterBob = await serverContent()
check('EDITOR update dropped while locked', !afterBob.includes('LOCKTEST-BOB-EXTRA'),
  `content has marker: ${afterBob.includes('LOCKTEST-BOB-EXTRA')}`)

// --- 2. owner socket CAN mutate while locked -----------------------------
const alice = await connect(ALICE)
const aliceText = alice.doc.getText('markdown')
const markerAt = aliceText.length
aliceText.insert(markerAt, '\nLOCKTEST-ALICE-OK')
await sleep(1200)
const afterAlice = await serverContent()
check('OWNER update accepted while locked', afterAlice.includes('LOCKTEST-ALICE-OK'))

// --- 3. REST enforcement --------------------------------------------------
const v1 = await rest(`/api/documents/${ROOM}/versions`, BOB, 'POST', {})
check('EDITOR cannot create version while locked (403)', v1.status === 403, `got ${v1.status}: ${v1.payload?.error}`)
const v2 = await rest(`/api/documents/${ROOM}/versions`, ALICE, 'POST', {})
check('OWNER can create version while locked (201)', v2.status === 201, `got ${v2.status}`)
const p = await rest(`/api/rooms/${ROOM}`, BOB, 'PATCH', { locked: false })
check('EDITOR cannot toggle the lock (403)', p.status === 403, `got ${p.status}`)
const g = await rest(`/api/documents/${ROOM}/versions`, BOB, 'GET')
check('viewer can still READ history (200)', g.status === 200, `got ${g.status}`)

// --- 4. unlock via owner, then editor writes are accepted again -----------
const unlock = await rest(`/api/rooms/${ROOM}`, ALICE, 'PATCH', { locked: true })
check('owner re-lock sanity (200)', unlock.status === 200, `got ${unlock.status}`)
// (room is currently locked — keep it locked; final unlock happens in the UI test)

// --- cleanup: remove the owner marker (owner is allowed while locked) ----
const current = aliceText.toString()
const idx = current.indexOf('LOCKTEST-ALICE-OK')
if (idx >= 0) aliceText.delete(idx - 1, '\nLOCKTEST-ALICE-OK'.length)
await sleep(1200)
const cleaned = await serverContent()
check('cleanup: marker removed', !cleaned.includes('LOCKTEST-ALICE-OK'))

bob.ws.close()
alice.ws.close()
console.log(failures === 0 ? '\nALL LOCK CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
