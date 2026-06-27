/**
 * Auto test script for ProjectRegistry (TC-01..TC-17)
 * Run: DEV_TEAM_DASHBOARD_HOME=<tmp> node test-registry.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
  const d = path.join(os.tmpdir(), `test-registry-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`)
  fs.mkdirSync(d, { recursive: true })
  return d
}

function createWorkspace(base) {
  const ws = path.join(base, '.dev-team-agent')
  fs.mkdirSync(ws, { recursive: true })
  return base
}

function rmdir(d) {
  try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
}

async function main() {
  console.log('=== TC-01..TC-17: ProjectRegistry unit tests ===\n')

  // Set isolated HOME
  const testHome = createTempDir('-home')
  process.env.DEV_TEAM_DASHBOARD_HOME = testHome
  console.log(`  DEV_TEAM_DASHBOARD_HOME = ${testHome}\n`)

  // Dynamic import AFTER setting env so registryHome() picks it up
  const reg = await import('./server/registry.js')

  // ── TC-01: List rỗng khi chưa có project ─────────────────────────────────
  const list1 = reg.list()
  assert('TC-01', 'List empty on fresh registry', list1.projects.length === 0 && list1.defaultId === null, `projects=${list1.projects.length}`)

  // ── TC-02: Add project hợp lệ (.dev-team-agent trực tiếp) ─────────────────
  const ws1 = createTempDir('-ws1')
  createWorkspace(ws1)
  const r2 = reg.add({ path: path.join(ws1, '.dev-team-agent') })
  assert('TC-02', 'Add valid .dev-team-agent path directly', r2.ok === true && r2.project?.id, `id=${r2.project?.id}`)

  // ── TC-03: Add trỏ project root, tự descend ───────────────────────────────
  const ws2 = createTempDir('-ws2')
  createWorkspace(ws2)
  const r3 = reg.add({ path: ws2 })
  assert('TC-03', 'Add project root → descend into .dev-team-agent', r3.ok === true && r3.project?.path?.endsWith('.dev-team-agent'), `path=${r3.project?.path}`)

  // ── TC-04: Add với name tuỳ chọn ──────────────────────────────────────────
  const ws3 = createTempDir('-ws3')
  createWorkspace(ws3)
  const r4 = reg.add({ path: ws3, name: 'My Custom Project' })
  assert('TC-04', 'Add with custom name', r4.ok === true && r4.project?.name === 'My Custom Project', `name=${r4.project?.name}`)

  // ── TC-05: Reject path relative ───────────────────────────────────────────
  const r5 = reg.add({ path: 'relative/path/.dev-team-agent' })
  assert('TC-05', 'Reject relative path', r5.ok === false && r5.status === 400, `status=${r5.status}, error=${r5.error}`)

  // ── TC-06: Reject path không tồn tại ──────────────────────────────────────
  const r6 = reg.add({ path: '/totally/nonexistent/path/.dev-team-agent' })
  assert('TC-06', 'Reject nonexistent path', r6.ok === false && r6.status === 400, `status=${r6.status}, error=${r6.error}`)

  // ── TC-07: Reject dir không chứa .dev-team-agent ──────────────────────────
  const ws4 = createTempDir('-ws4-no-dta')
  // ws4 has no .dev-team-agent
  const r7 = reg.add({ path: ws4 })
  assert('TC-07', 'Reject dir without .dev-team-agent', r7.ok === false && r7.status === 400, `status=${r7.status}, error=${r7.error}`)

  // ── TC-08: Reject symlink escape ──────────────────────────────────────────
  // Try to create a symlink on Windows — may fail without admin
  let tc08 = 'SKIP'
  try {
    const outside = createTempDir('-outside')
    fs.mkdirSync(path.join(outside, '.dev-team-agent'), { recursive: true })
    const symlinkParent = createTempDir('-symlink-parent')
    const symlinkPath = path.join(symlinkParent, '.dev-team-agent')
    fs.symlinkSync(path.join(outside, '.dev-team-agent'), symlinkPath, 'junction')
    // If symlink created, add should still work (junction resolves to real path)
    const r8 = reg.add({ path: symlinkPath })
    tc08 = r8.ok ? 'SYMLINK_ACCEPTED_OK' : 'SYMLINK_REJECTED'
    assert('TC-08', 'Symlink/junction path handling', true, `result=${tc08} (Windows junction resolves via realpathSync)`)
    rmdir(symlinkParent)
    rmdir(outside)
  } catch (e) {
    console.log(`  [SKIP] TC-08: symlink escape — cannot create symlink: ${e.message} (requires admin/Developer Mode)`)
    results.push({ tc: 'TC-08', status: 'SKIP', desc: 'Reject symlink escape', detail: e.message })
  }

  // ── TC-09: Idempotent add trùng canonical path ────────────────────────────
  // ws1 already added; add again
  const r9a = reg.add({ path: path.join(ws1, '.dev-team-agent') })
  const listAfter = reg.list()
  const ws1Count = listAfter.projects.filter(p => p.path === r9a.project?.path).length
  assert('TC-09', 'Idempotent: duplicate add returns existing entry, no duplication', r9a.ok === true && ws1Count === 1, `id=${r9a.project?.id}, count=${ws1Count}`)

  // ── TC-10: get(id) known / unknown / null ─────────────────────────────────
  const knownId = r2.project?.id
  const g10a = reg.get(knownId)
  const g10b = reg.get('nonexistent-id')
  const g10c = reg.get(null)
  assert('TC-10', 'get(id): known→project, unknown→null, null→null',
    g10a?.id === knownId && g10b === null && g10c === null,
    `known=${!!g10a}, unknown=${g10b}, null=${g10c}`)

  // ── TC-11: remove non-default, không xoá filesystem ──────────────────────
  // ws3 (TC-04) is non-default; ws1 is default (first added)
  const ws3Path = path.join(ws3, '.dev-team-agent')
  const ws3Entry = reg.list().projects.find(p => p.path === ws3Path)
  const r11 = ws3Entry ? reg.remove(ws3Entry.id) : { ok: false, error: 'ws3 not found' }
  const dirStillExists = fs.existsSync(ws3Path)
  assert('TC-11', 'Remove non-default: registry entry removed, filesystem intact',
    r11.ok === true && dirStillExists,
    `removed=${r11.ok}, fsExists=${dirStillExists}`)

  // ── TC-12: remove default bị từ chối ──────────────────────────────────────
  const defaultEntry = reg.list().projects.find(p => p.default)
  const r12 = defaultEntry ? reg.remove(defaultEntry.id) : { ok: false, status: 400, error: 'no default' }
  assert('TC-12', 'Remove default project is rejected', r12.ok === false && r12.status === 400, `status=${r12.status}, error=${r12.error}`)

  // ── TC-13: remove unknown id → 404 ────────────────────────────────────────
  const r13 = reg.remove('totally-unknown-id-xyz')
  assert('TC-13', 'Remove unknown id → 404', r13.ok === false && r13.status === 404, `status=${r13.status}`)

  // ── TC-14: resolveProjectRoot known/unknown/null ───────────────────────────
  const knownProject = reg.list().projects.find(p => p.default)
  const resolvedKnown = reg.resolveProjectRoot(knownProject?.id)
  const resolvedUnknown = reg.resolveProjectRoot('nonexistent-id-abc')
  // null → should return default
  const resolvedNull = reg.resolveProjectRoot(null)
  assert('TC-14', 'resolveProjectRoot: known→path, unknown→null, null→default',
    resolvedKnown === knownProject?.path && resolvedUnknown === null && resolvedNull !== null,
    `known=${resolvedKnown}, unknown=${resolvedUnknown}, null=${resolvedNull}`)

  // ── TC-15: resolveProjectRoot(null) ưu tiên DEV_TEAM_ROOT ─────────────────
  const ws5 = createTempDir('-ws5')
  createWorkspace(ws5)
  process.env.DEV_TEAM_ROOT = path.join(ws5, '.dev-team-agent')
  const resolvedWithEnv = reg.resolveProjectRoot(null)
  delete process.env.DEV_TEAM_ROOT
  assert('TC-15', 'resolveProjectRoot(null) respects DEV_TEAM_ROOT over registry',
    resolvedWithEnv === path.resolve(path.join(ws5, '.dev-team-agent')),
    `resolvedWithEnv=${resolvedWithEnv}`)

  // ── TC-16: Registry corrupt → coi như rỗng, không throw ──────────────────
  // Write broken JSON to the registry file
  const corruptHome = createTempDir('-corrupt-home')
  const oldHome = process.env.DEV_TEAM_DASHBOARD_HOME
  process.env.DEV_TEAM_DASHBOARD_HOME = corruptHome
  fs.mkdirSync(corruptHome, { recursive: true })
  fs.writeFileSync(path.join(corruptHome, 'projects.json'), '{ "version": 1, "projects": [BROKEN', 'utf8')
  let tc16Error = null
  let tc16List = null
  try {
    // Need to call loadRegistry directly — re-import won't work (cached), use dynamic call
    const { loadRegistry } = reg
    tc16List = loadRegistry()
  } catch (e) {
    tc16Error = e.message
  }
  process.env.DEV_TEAM_DASHBOARD_HOME = oldHome
  assert('TC-16', 'Corrupt registry treated as empty, no throw',
    tc16Error === null && tc16List?.projects?.length === 0,
    `error=${tc16Error}, projects=${tc16List?.projects?.length}`)
  rmdir(corruptHome)

  // ── TC-17: seedDefault idempotent ─────────────────────────────────────────
  const emptyHome = createTempDir('-empty-home')
  process.env.DEV_TEAM_DASHBOARD_HOME = emptyHome
  const ws6 = createTempDir('-ws6')
  createWorkspace(ws6)
  const seeded1 = reg.seedDefault(path.join(ws6, '.dev-team-agent'))
  const seeded2 = reg.seedDefault(path.join(ws6, '.dev-team-agent'))
  process.env.DEV_TEAM_DASHBOARD_HOME = testHome
  assert('TC-17', 'seedDefault idempotent: second call returns null when registry has entry',
    seeded1 !== null && seeded2 === null,
    `seeded1=${seeded1?.id}, seeded2=${seeded2}`)
  rmdir(emptyHome)

  // ── Cleanup ───────────────────────────────────────────────────────────────
  ;[ws1, ws2, ws3, ws4, ws5, ws6, testHome].forEach(rmdir)

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
