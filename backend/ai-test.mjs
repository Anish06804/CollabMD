// AI + language library test suite (backend-internal, run with `node`)
const BASE = 'http://127.0.0.1:4000'

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['x-collabmd-token'] = token
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json, text }
}

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`) }
}

async function main() {
  // --- auth ---
  const room = await req('POST', '/api/rooms', { name: 'AI Tests', displayName: 'Bot', access: 'edit' })
  check('create room', room.status === 201 && room.json?.user?.token, `status=${room.status}`)
  const token = room.json?.user?.token
  if (!token) { console.log('fatal: no token'); process.exit(1) }

  // --- AI engines / types ---
  const engines = await req('GET', '/api/ai/mermaid/engines', null, token)
  check('GET engines', engines.status === 200 && engines.json?.engine === 'local', JSON.stringify(engines.json))

  const types = await req('GET', '/api/ai/mermaid/types', null, token)
  check('GET types', types.status === 200 && types.json?.types?.length === 10, JSON.stringify(types.json))

  // --- generate each diagram type ---
  const cases = [
    {
      name: 'flowchart arrows',
      body: { prompt: 'User opens app -> Login page -> Dashboard\nLogin page -> Error screen: wrong password' },
      expect: 'flowchart', mustInclude: ['flowchart TD', '-->'], minNodes: 3,
    },
    {
      name: 'flowchart outline',
      body: { prompt: 'Authentication\n  Login\n    Email\n    Password\n  Signup' },
      expect: 'flowchart', mustInclude: ['flowchart TD', '['], minNodes: 3,
    },
    {
      name: 'sequence calls',
      body: { prompt: 'Client sends login request\nServer returns JWT token' },
      expect: 'sequence', mustInclude: ['sequenceDiagram', '->>'], minNodes: 2,
    },
    {
      name: 'sequence arrows',
      body: { prompt: 'API -> Database: query\nDatabase -> API: rows', type: 'sequence' },
      expect: 'sequence', mustInclude: ['sequenceDiagram'], minNodes: 2,
    },
    {
      name: 'class inheritance',
      body: { prompt: 'Animal extends LivingThing\nDog extends Animal\nDog {\n  +bark(): void\n  -age: int\n}' },
      expect: 'class', mustInclude: ['classDiagram', '<|--'], minNodes: 2,
    },
    {
      name: 'ER relations',
      body: { prompt: 'Customer has many Orders\nOrder has many Items' },
      expect: 'er', mustInclude: ['erDiagram', '||--o{'], minNodes: 2,
    },
    {
      name: 'ER table block',
      body: { prompt: 'users(id: uuid, email: string, created_at: timestamp)' },
      expect: 'er', mustInclude: ['erDiagram'], minNodes: 1,
    },
    {
      name: 'state transitions',
      body: { prompt: 'Draft -> Review: submit\nReview -> Published: approve\nReview -> Draft: reject' },
      expect: 'state', mustInclude: ['stateDiagram-v2', '-->'], minNodes: 3,
    },
    {
      name: 'pie shares',
      body: { prompt: 'Chrome 65\nSafari 20\nFirefox 10\nEdge 5' },
      expect: 'pie', mustInclude: ['pie'], minNodes: 4,
    },
    {
      name: 'gantt tasks',
      body: { prompt: 'phase Design\nDesign: 2026-01-01, 10d\nBuild: 2026-01-11, 20d\nphase Launch\nShip: after Build, 5d' },
      expect: 'gantt', mustInclude: ['gantt', 'section Design', 'section Launch'], minNodes: 3,
    },
    {
      name: 'journey steps',
      body: { prompt: 'Sign up: 4: New user\nFind docs: 3: New user\nShip feature: 8: Developer' },
      expect: 'journey', mustInclude: ['journey', 'title'], minNodes: 3,
    },
    {
      name: 'timeline periods',
      body: { prompt: '2024: Founded; Seed round\n2025: Product launch\n2026: International expansion' },
      expect: 'timeline', mustInclude: ['timeline'], minNodes: 3,
    },
    {
      name: 'mindmap hierarchy',
      body: { prompt: 'Mind map: CollabMD\n  Editing\n    Markdown\n    Mermaid\n  Sharing\n    Rooms' },
      expect: 'mindmap', mustInclude: ['mindmap', 'root(('], minNodes: 3,
    },
    {
      name: 'mindmap by explicit type',
      body: { prompt: 'CollabMD\n  Editing\n    Markdown\n  Sharing', type: 'mindmap' },
      expect: 'mindmap', mustInclude: ['mindmap', 'root(('], minNodes: 3,
    },
  ]

  for (const c of cases) {
    const r = await req('POST', '/api/ai/mermaid', c.body, token)
    const ok =
      r.status === 200 &&
      r.json?.diagramType === c.expect &&
      c.mustInclude.every((s) => (r.json?.code ?? '').includes(s)) &&
      (r.json?.stats?.nodes ?? 0) >= c.minNodes &&
      (r.json?.engine === 'local' || r.json?.engine === 'llm')
    check(
      `generate: ${c.name}`,
      ok,
      `status=${r.status} type=${r.json?.diagramType} nodes=${r.json?.stats?.nodes}\n${r.json?.code ?? r.text}`,
    )
    if (!ok && r.json?.code) console.log('---- code ----\n' + r.json.code + '\n-------------')
  }

  // --- auto-detection ---
  const autoCases = [
    { prompt: 'Which service returns 200 OK -> Client', expect: 'sequence' },
    { prompt: 'Customer has many Orders; Order references Cart', expect: 'er' },
    { prompt: 'Mobile 60%\nDesktop 40%', expect: 'pie' },
    { prompt: 'phase One\nDesign: 2026-01-01, 5d', expect: 'gantt' },
    { prompt: 'A -> B -> C', expect: 'flowchart' },
  ]
  for (const c of autoCases) {
    const r = await req('POST', '/api/ai/mermaid', { prompt: c.prompt }, token)
    check(`auto-detect -> ${c.expect}`, r.status === 200 && r.json?.diagramType === c.expect, `got ${r.json?.diagramType}`)
  }

  // --- validation endpoint ---
  const v1 = await req('POST', '/api/ai/mermaid/validate', { code: 'flowchart TD\n  a --> b' }, token)
  check('validate good diagram', v1.status === 200 && v1.json?.valid === true, JSON.stringify(v1.json))

  const v2 = await req('POST', '/api/ai/mermaid/validate', { code: 'flowchart TD\n  a["x" --> b' }, token)
  check('validate broken diagram', v2.status === 200 && v2.json?.valid === false && v2.json?.errors?.length > 0, JSON.stringify(v2.json))

  const v3 = await req('POST', '/api/ai/mermaid/validate', { code: 'banana TD\n a --> b' }, token)
  check('validate unknown header', v3.status === 200 && v3.json?.valid === false, JSON.stringify(v3.json))

  // --- AI errors ---
  const e1 = await req('POST', '/api/ai/mermaid', { prompt: '' }, token)
  check('empty prompt rejected', e1.status === 400, `status=${e1.status}`)

  const e2 = await req('GET', '/api/ai/mermaid/engines', null)
  check('unauthenticated rejected', e2.status === 401, `status=${e2.status}`)

  // --- language library ---
  const lib = await req('GET', '/api/execute/languages', null, token)
  check(
    'language library: many languages',
    lib.status === 200 && lib.json?.library?.length >= 60,
    `got ${lib.json?.library?.length}`,
  )
  const runnable = lib.json?.library?.filter((l) => l.runnable) ?? []
  check('language library: some runnable', runnable.length >= 3, `runnable=${runnable.map((l) => l.id).join(',')}`)
  console.log('  INFO  runnable: ' + runnable.map((l) => `${l.id}${l.version ? ` (${l.version.slice(0, 30)})` : ''}`).join(', '))
  check(
    'python3 Store stub NOT runnable',
    !runnable.some((l) => l.id === 'python3'),
    'python3 should not be marked runnable on Windows',
  )

  // --- language detection ---
  const detCases = [
    { code: 'def hello():\n    print("hi")\n    return None', expect: 'python' },
    { code: 'console.log("hi");\nconst x = () => 1;', expect: 'javascript' },
    { code: 'interface User {\n  name: string\n  age?: number\n}', expect: 'typescript' },
    { code: '#include <stdio.h>\nint main() { printf("hi"); return 0; }', expect: 'c' },
    { code: '#include <iostream>\nint main() { std::cout << "hi"; return 0; }', expect: 'cpp' },
    { code: 'SELECT id, name FROM users WHERE active = true;', expect: 'sql' },
    { code: 'fn main() {\n    let mut x = 5;\n    println!("{}", x);\n}', expect: 'rust' },
    { code: '#!/bin/bash\necho $HOME\nls -la | grep txt', expect: 'bash' },
    { code: 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("hi");\n  }\n}', expect: 'java' },
    { code: '<?php\necho "hi";\n?>', expect: 'php' },
    { code: 'func main() {\n\tfmt.Println("hi")\n}', expect: 'go' },
    { code: 'let x: number = 5;\nconst y = x + 1;', expect: 'typescript' },
    { code: 'package main\nimport "fmt"', expect: 'go' },
    { code: 'print("hello world")', expect: 'python' },
    { code: 'puts "hello"', expect: 'ruby' },
    { code: 'Console.WriteLine("hi");', expect: 'csharp' },
    { code: 'fun main() {\n  val x = 1\n  println(x)\n}', expect: 'kotlin' },
    { code: '#!/usr/bin/env python3\nimport os\nprint(os.getcwd())', expect: 'python' },
  ]
  let detPass = 0
  for (const c of detCases) {
    const r = await req('POST', '/api/execute/detect', { code: c.code }, token)
    const got = r.json?.language?.id
    if (r.status === 200 && got === c.expect) detPass++
    else console.log(`  MISS  detect "${c.code.slice(0, 30).replace(/\n/g, ' ')}..." expected=${c.expect} got=${got} candidates=${(r.json?.candidates ?? []).map((x) => x.id).join(',')}`)
  }
  check(`language detection: ${detPass}/${detCases.length} correct`, detPass >= Math.ceil(detCases.length * 0.8))

  // --- execution still works ---
  const run = await req('POST', '/api/execute', { code: 'print(2**10)', language: 'python' }, token)
  check('execute python', run.status === 200 && run.json?.stdout?.trim() === '1024', JSON.stringify(run.json))

  const runC = await req('POST', '/api/execute', { code: '#include <stdio.h>\nint main(){printf("%d", 7*6);return 0;}', language: 'c' }, token)
  check('execute C (compile+run)', runC.status === 200 && runC.json?.stdout?.trim() === '42', JSON.stringify(runC))

  const runCpp = await req('POST', '/api/execute', { code: '#include <iostream>\nint main(){std::cout << 6*7;}', language: 'cpp' }, token)
  check('execute C++ (compile+run)', runCpp.status === 200 && runCpp.json?.stdout?.trim() === '42', JSON.stringify(runCpp))

  const runTs = await req('POST', '/api/execute', { code: 'console.log([1,2,3].reduce((a,b)=>a+b,0))', language: 'typescript' }, token)
  check('execute TypeScript', runTs.status === 200 && runTs.json?.stdout?.trim() === '6', JSON.stringify(runTs))

  const runPS = await req('POST', '/api/execute', { code: 'Write-Output (2+3)', language: 'powershell' }, token)
  check('execute PowerShell', runPS.status === 200 && runPS.json?.stdout?.trim() === '5', JSON.stringify(runPS))

  const runBad = await req('POST', '/api/execute', { code: 'x=1', language: 'brainfuck' }, token)
  check('unsupported language rejected', runBad.status === 400, `status=${runBad.status}`)

  // --- mermaid render sanity: generated code must parse in mermaid? (backend can't run mermaid; structural lint only)
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => { console.error(err); process.exit(1) })
