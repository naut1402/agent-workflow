/**
 * Auto test script for REST API handler (TC-18..TC-30)
 * Run: node test-api.mjs
 * Uses createApiHandler mounted on a plain node:http server; no separate
 * standalone server needed.
 */
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let passed = 0
let failed = 0
const results = []

function assert(tc, desc, cond, detail = '') {
  if (cond) {
    passed++
    results.push({ tc, status: 'PASS', desc, detail })
    console.log(`  [PASS] ${tc}: ${desc}${detail ? ' — ' + detail : ''}`)
  } else {
    failed++
    results.push({ tc, status: 'FAIL', desc, detail })
    console.error(`  [FAIL] ${tc}: ${desc}${detail ? ' — ' + detail : ''}`)
  }
}

function createTempDir(suffix = '') {
  const d = path.join(os.tmpdir(), `test-api-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`)
  fs.mkdirSync(d, { recursive: true })
  return d
}

function createWorkspace(base) {
  const ws = path.join(base, '.dev-team-agent')
  fs.mkdirSync(ws, { recursive: true })
  const tasksDir = path.join(ws, 'tasks')
  fs.mkdirSync(tasksDir, { recursive: true })
  return ws
}

function rmdir(d) {
  try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
}

function req(server, method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address()
    const opts = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    }
    const r = http.request(opts, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(data) } catch { /* raw */ }
        resolve({ status: res.statusCode, body: json, raw: data })
      })
    })
    r.on('error', reject)
    if (body !== null) r.write(typeof body === 'string' ? body : JSON.stringify(body))
    r.end()
  })
}

async function startServer(ctx) {
  const { createApiHandler } = await import('./server/devTeamApi.js')
  const handler = createApiHandler(ctx)
  return new Promise((resolve) => {
    const server = http.createServer(async (request, response) => {
      const handled = await handler(request, response)
      if (!handled) {
        response.statusCode = 404
        response.end(JSON.stringify({ error: 'not api' }))
      }
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function main() {
  console.log('=== TC-18..TC-30: REST API tests ===\n')

  // Setup: 2 isolated workspaces with tasks
  const testHome = createTempDir('-home')
  process.env.DEV_TEAM_DASHBOARD_HOME = testHome

  const wsABase = createTempDir('-wsA')
  const wsARoot = createWorkspace(wsABase)
  // Create a task in workspace A
  const taskADir = path.join(wsARoot, 'tasks', 'TASK-A001')
  fs.mkdirSync(taskADir, { recursive: true })
  fs.mkdirSync(path.join(wsARoot, '.dev-state'), { recursive: true })
  fs.writeFileSync(path.join(wsARoot, '.dev-state', 'TASK-A001.json'), JSON.stringify({ current_phase: 'investigate' }))

  const wsBBase = createTempDir('-wsB')
  const wsBRoot = createWorkspace(wsBBase)
  // Create a task in workspace B
  const taskBDir = path.join(wsBRoot, 'tasks', 'TASK-B001')
  fs.mkdirSync(taskBDir, { recursive: true })
  fs.mkdirSync(path.join(wsBRoot, '.dev-state'), { recursive: true })
  fs.writeFileSync(path.join(wsBRoot, '.dev-state', 'TASK-B001.json'), JSON.stringify({ current_phase: 'design' }))

  // Create an artifact for traversal test (TC-30)
  fs.writeFileSync(path.join(taskADir, 'investigate.md'), '# Test artifact', 'utf8')
  // Create a secret file outside task dir for traversal test
  const secretFile = path.join(wsARoot, 'secret.txt')
  fs.writeFileSync(secretFile, 'secret content', 'utf8')

  // Import registry and add projects
  const regModule = await import('./server/registry.js')
  const rA = regModule.add({ path: wsARoot, name: 'WS-A' })
  const rB = regModule.add({ path: wsBBase, name: 'WS-B' })
  console.log(`  wsA id=${rA.project?.id}, wsB id=${rB.project?.id}\n`)

  const ctx = regModule.createRegistryContext({ defaultRoot: wsARoot })
  const server = await startServer(ctx)

  try {
    // ── TC-18: Backward-compat GET /api/tasks KHÔNG có project ──────────────
    const r18 = await req(server, 'GET', '/api/tasks')
    assert('TC-18', 'GET /api/tasks (no project) → 200 with root+tasks shape',
      r18.status === 200 && 'root' in r18.body && Array.isArray(r18.body.tasks) && !('project' in r18.body),
      `status=${r18.status}, hasRoot=${!!r18.body?.root}, hasTasks=${Array.isArray(r18.body?.tasks)}, hasProject=${!!r18.body?.project}`)

    // ── TC-19: GET /api/tasks?project=B trả đúng task B ────────────────────
    const r19 = await req(server, 'GET', `/api/tasks?project=${rB.project?.id}`)
    const tasksB = r19.body?.tasks || []
    const hasBTask = tasksB.some(t => t.task_id === 'TASK-B001')
    const hasATask = tasksB.some(t => t.task_id === 'TASK-A001')
    assert('TC-19', 'GET /api/tasks?project=B → only B tasks',
      r19.status === 200 && hasBTask && !hasATask,
      `status=${r19.status}, hasBTask=${hasBTask}, hasATask=${hasATask}`)

    // ── TC-20: GET /api/tasks?project=unknown → 404 ─────────────────────────
    const r20 = await req(server, 'GET', '/api/tasks?project=nonexistent-project-id')
    assert('TC-20', 'GET /api/tasks?project=unknown → 404',
      r20.status === 404,
      `status=${r20.status}`)

    // ── TC-21: GET /api/projects list + GET ?id= ────────────────────────────
    const r21a = await req(server, 'GET', '/api/projects')
    const r21b = await req(server, 'GET', `/api/projects?id=${rA.project?.id}`)
    const r21c = await req(server, 'GET', '/api/projects?id=nonexistent')
    assert('TC-21', 'GET /api/projects list + GET ?id=known + GET ?id=unknown',
      r21a.status === 200 && Array.isArray(r21a.body?.projects) &&
      r21b.status === 200 && r21b.body?.project?.id === rA.project?.id &&
      r21c.status === 404,
      `list=${r21a.status}, knownId=${r21b.status}, unknown=${r21c.status}, count=${r21a.body?.projects?.length}`)

    // ── TC-22: POST /api/projects hợp lệ → 201 ─────────────────────────────
    const ws3Base = createTempDir('-ws3')
    createWorkspace(ws3Base)
    const r22 = await req(server, 'POST', '/api/projects', { path: ws3Base, name: 'WS-C' })
    assert('TC-22', 'POST /api/projects valid → 201',
      r22.status === 201 && r22.body?.project?.name === 'WS-C',
      `status=${r22.status}, name=${r22.body?.project?.name}`)
    rmdir(ws3Base)

    // ── TC-23: POST body JSON hỏng → 400 ────────────────────────────────────
    const r23 = await req(server, 'POST', '/api/projects', '{ BAD JSON }')
    assert('TC-23', 'POST invalid JSON body → 400',
      r23.status === 400,
      `status=${r23.status}, error=${r23.body?.error}`)

    // ── TC-24: POST path relative → 400 ─────────────────────────────────────
    const r24 = await req(server, 'POST', '/api/projects', { path: 'relative/path' })
    assert('TC-24', 'POST relative path → 400 (security)',
      r24.status === 400,
      `status=${r24.status}, error=${r24.body?.error}`)

    // ── TC-25: DELETE non-default → 200 ─────────────────────────────────────
    const ws4Base = createTempDir('-ws4')
    createWorkspace(ws4Base)
    const addR = await req(server, 'POST', '/api/projects', { path: ws4Base, name: 'WS-D' })
    const ws4Id = addR.body?.project?.id
    const r25 = ws4Id ? await req(server, 'DELETE', `/api/projects?id=${ws4Id}`) : { status: 0, body: { error: 'not added' } }
    assert('TC-25', 'DELETE non-default project → 200',
      r25.status === 200 && r25.body?.removed === true,
      `status=${r25.status}, removed=${r25.body?.removed}`)
    rmdir(ws4Base)

    // ── TC-26: DELETE default → 400 ─────────────────────────────────────────
    const defaultProject = (await req(server, 'GET', '/api/projects')).body?.projects?.find(p => p.default)
    const r26 = defaultProject ? await req(server, 'DELETE', `/api/projects?id=${defaultProject.id}`) : { status: 0, body: { error: 'no default' } }
    assert('TC-26', 'DELETE default project → 400',
      r26.status === 400,
      `status=${r26.status}, error=${r26.body?.error}`)

    // ── TC-27: PUT /api/projects → 405 ──────────────────────────────────────
    const r27 = await req(server, 'PUT', '/api/projects', { path: wsARoot })
    assert('TC-27', 'PUT /api/projects → 405',
      r27.status === 405,
      `status=${r27.status}`)

    // ── TC-28: Endpoint không tồn tại → 404 ────────────────────────────────
    const r28 = await req(server, 'GET', '/api/nonexistent-endpoint')
    assert('TC-28', 'GET /api/nonexistent → 404',
      r28.status === 404,
      `status=${r28.status}`)

    // ── TC-29: Non-/api request → handler trả false (server returns 404) ────
    const r29 = await req(server, 'GET', '/index.html')
    // Our test server returns 404 for non-api, which means handler returned false
    assert('TC-29', 'Non-/api request → handler returns false (server 404)',
      r29.status === 404,
      `status=${r29.status}`)

    // ── TC-30: Artifact hợp lệ + traversal bị chặn ──────────────────────────
    // Valid artifact
    const r30a = await req(server, 'GET', `/api/artifact?id=TASK-A001&name=investigate.md&project=${rA.project?.id}`)
    // Path traversal attempt
    const r30b = await req(server, 'GET', `/api/artifact?id=TASK-A001&name=../../secret.txt&project=${rA.project?.id}`)
    assert('TC-30', 'Valid artifact returns 200; traversal attempt → 400 (blocked)',
      r30a.status === 200 && r30a.body?.content === '# Test artifact' &&
      r30b.status === 400,
      `valid=${r30a.status}, traversal=${r30b.status}, traversalError=${r30b.body?.error}`)

  } finally {
    server.close()
    ;[wsABase, wsBBase, testHome].forEach(rmdir)
    delete process.env.DEV_TEAM_DASHBOARD_HOME
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n=== SUMMARY ===')
  const skipCount = results.filter(r => r.status === 'SKIP').length
  console.log(`  ${passed} passed, ${failed} failed, ${skipCount} skipped`)
  console.log(`  Total: ${results.length} cases`)

  if (failed > 0) {
    console.error('\n  FAILED cases:')
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.error(`    ${r.tc}: ${r.desc} — ${r.detail}`)
    })
    process.exit(1)
  }
  process.exit(0)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(2)
})
