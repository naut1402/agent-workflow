/**
 * Verification for U0004 — Knowledge mode + API.
 * Run: node scripts/verify-knowledge.mjs [baseUrl]
 * Requires dashboard server: npm run serve (default http://localhost:5174)
 */
import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '../docs/u0004-evidence')
const BASE = process.argv[2] || 'http://localhost:5174'
const TEST_SLUG = `u0004-verify-${Date.now()}`

async function api(pathname, opts = {}) {
  const r = await fetch(`${BASE}${pathname}`, opts)
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data }
}

async function main() {
  await fs.mkdir(OUT, { recursive: true })
  const results = []

  // API: create
  const create = await api('/api/knowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Verify entry',
      slug: TEST_SLUG,
      scope: 'project',
      tags: ['verify', 'u0004'],
      content: '# Verify\n\nKnowledge API test body.',
    }),
  })
  const entryId = create.data?.entry?.id
  results.push({
    id: 'API-create',
    pass: create.ok && entryId === `project/${TEST_SLUG}`,
    note: create.ok ? entryId : JSON.stringify(create.data),
  })

  // API: list + tag filter
  const list = await api('/api/knowledge?scope=project')
  const listed = (list.data?.entries || []).some((e) => e.id === entryId)
  results.push({ id: 'API-list', pass: list.ok && listed, note: `count=${list.data?.entries?.length}` })

  const tags = await api('/api/knowledge/tags')
  const hasVerifyTag = (tags.data?.tags || []).some((t) => t.tag === 'verify')
  results.push({ id: 'API-tags', pass: tags.ok && hasVerifyTag, note: '' })

  // API: upload
  const boundary = '----verifyBoundary'
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="scope"',
    '',
    'project',
    `--${boundary}`,
    'Content-Disposition: form-data; name="tags"',
    '',
    'upload,verify',
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="upload-test.md"',
    'Content-Type: text/markdown',
    '',
    '# Upload test\n\nUploaded via verify script.',
    `--${boundary}--`,
    '',
  ].join('\r\n')
  const upload = await api('/api/knowledge/upload', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  })
  results.push({
    id: 'API-upload',
    pass: upload.ok && upload.data?.entry?.id === 'project/upload-test',
    note: upload.data?.entry?.id || JSON.stringify(upload.data),
  })

  // API: delete test entries
  if (entryId) await api(`/api/knowledge?id=${encodeURIComponent(entryId)}`, { method: 'DELETE' })
  await api('/api/knowledge?id=project%2Fupload-test', { method: 'DELETE' })

  // UI: Knowledge mode visible
  let uiPass = false
  try {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 })
    await page.getByRole('button', { name: 'Knowledge' }).click()
    await page.waitForTimeout(500)
    uiPass = (await page.locator('.knowledge-panel').count()) > 0
    await page.screenshot({ path: path.join(OUT, 'knowledge-mode.png'), fullPage: false })
    await browser.close()
  } catch (e) {
    results.push({ id: 'UI-mode', pass: false, note: String(e.message || e) })
  }
  if (!results.find((r) => r.id === 'UI-mode')) {
    results.push({ id: 'UI-mode', pass: uiPass, note: 'knowledge-panel visible' })
  }

  const pass = results.every((r) => r.pass)
  const out = { base: BASE, results, pass }
  await fs.writeFile(path.join(OUT, 'verify-results.json'), JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
