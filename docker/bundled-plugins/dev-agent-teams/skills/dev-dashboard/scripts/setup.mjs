#!/usr/bin/env node
// Bootstrap a project's dev-team state directory.
//
//   node setup.mjs [projectRoot]
//
// The dashboard APP itself lives in a separate repo
// (https://github.com/naut1402/agent-workflow) — this script no longer copies a
// bundled viewer. It only prepares the project-side `.dev-team-agent/` state that
// the orchestrator writes and the dashboard reads.
//
// Steps (all idempotent):
//   1. Ensure <projectRoot>/.dev-team-agent/ exists.
//   2. Migrate legacy top-level `tasks/` and `.dev-state/` into it (if present
//      at the project root and not already migrated).
//   3. Scaffold a default `pipeline.yaml` from the canonical asset.
//   4. Add `.dev-team-agent/` to the project's .gitignore.
//   5. Inject rule-reference placeholders into CLAUDE.md.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(process.argv[2] || process.cwd())
const dta = path.join(projectRoot, '.dev-team-agent')

function log(msg) {
  console.log(`[dev-dashboard] ${msg}`)
}

fs.mkdirSync(dta, { recursive: true })
fs.mkdirSync(path.join(dta, 'pipeline-profiles'), { recursive: true })

// 2. Migrate legacy layout.
for (const dir of ['tasks', '.dev-state']) {
  const oldPath = path.join(projectRoot, dir)
  const newPath = path.join(dta, dir)
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    fs.renameSync(oldPath, newPath)
    log(`migrated ${dir}/ → .dev-team-agent/${dir}/`)
  }
}

// 2b. Scaffold a default pipeline.yaml (idempotent — never clobber an edited one).
//     Reads the canonical asset that the orchestrator + /init-dev-pipeline also
//     use, so there is one source of truth the user can then customise.
const pipelinePath = path.join(dta, 'pipeline.yaml')
const defaultPipelineAsset = path.resolve(
  __dirname,
  '../../dev-team-orchestrator/assets/pipeline.default.yaml',
)
const DEFAULT_PIPELINE_YAML = fs.readFileSync(defaultPipelineAsset, 'utf8')
if (fs.existsSync(pipelinePath)) {
  log('pipeline.yaml already exists — skipped')
} else {
  fs.writeFileSync(pipelinePath, DEFAULT_PIPELINE_YAML)
  log('scaffolded default pipeline.yaml → .dev-team-agent/pipeline.yaml')
}

// 4. .gitignore
const giPath = path.join(projectRoot, '.gitignore')
const entry = '.dev-team-agent/'
let gi = ''
try {
  gi = fs.readFileSync(giPath, 'utf8')
} catch {
  /* no .gitignore yet */
}
const has = gi.split(/\r?\n/).some((l) => l.trim() === entry || l.trim() === entry.replace(/\/$/, ''))
if (!has) {
  const sep = gi && !gi.endsWith('\n') ? '\n' : ''
  fs.writeFileSync(giPath, `${gi}${sep}\n# dev-agent-teams dashboard + state\n${entry}\n`)
  log(`added "${entry}" to .gitignore`)
}

// 5. Inject rule-reference placeholders into CLAUDE.md (idempotent).
const RULES_MARKER = '<!-- dev-team-agent:rules -->'
const RULES_SECTION = `
${RULES_MARKER}
## Dev Team — Tham chiếu Rule & Cấu trúc

> Orchestrator nạp các rule này qua skill \`read-project-rules\` ở đầu pipeline.
> Điền đường dẫn / nội dung cụ thể bên dưới. Mục có ⚠ là **bắt buộc** — pipeline sẽ dừng nếu thiếu.

### Rule coding
<!-- Điền đường dẫn hoặc mô tả quy tắc coding của project (naming, style, lint rules) -->
Chưa thiết lập

### Rule viết tài liệu (doc-writing) ⚠ Bắt buộc
<!-- Investigator và designer đọc rule này để format investigate.md / design.md.
     Ví dụ: "xem coding-conventions.md §Doc" hoặc paste nội dung trực tiếp. -->
Chưa thiết lập

### Rule trình bày (presentation)
<!-- Quy tắc format tài liệu: heading style, ngôn ngữ (vn/jp), bảng vs list, độ dài mục -->
Chưa thiết lập

### Rule viết test case
<!-- Framework (PHPUnit/Jest/…), cấu trúc (AAA), coverage targets, naming convention -->
Chưa thiết lập

### File cấu trúc dự án
<!-- Đường dẫn file mô tả kiến trúc project, e.g. docs/STRUCTURE.md hoặc src/README.md -->
Chưa thiết lập
`

const claudeMdPath = path.join(projectRoot, 'CLAUDE.md')
let claudeMd = ''
try {
  claudeMd = fs.readFileSync(claudeMdPath, 'utf8')
} catch {
  /* CLAUDE.md may not exist yet — will be created */
}

if (claudeMd.includes(RULES_MARKER)) {
  log('CLAUDE.md rules section already exists — skipped')
} else {
  const sep = claudeMd && !claudeMd.endsWith('\n') ? '\n' : ''
  fs.writeFileSync(claudeMdPath, `${claudeMd}${sep}${RULES_SECTION}\n`)
  log('added rule placeholders → CLAUDE.md')
}

log('done. State ready — the dashboard app is fetched separately.')
log('')
log('Next: clone + run the dashboard app (repo: naut1402/agent-workflow).')
log('  APP_DIR="${DEV_TEAM_DASHBOARD_APP:-~/.dev-team-dashboard/app}"')
log('  git clone https://github.com/naut1402/agent-workflow "$APP_DIR"   # first time')
log('')
log('Single-project run (this project):')
log(`  cd "$APP_DIR" && bun install && DEV_TEAM_ROOT="${dta}" bun run dev`)
log('')
log('Multi-project (standalone) run — one neutral server pointing at N projects:')
log('  cd "$APP_DIR" && bun install && bun run serve')
log('  → opens http://127.0.0.1:5174; add each project via the UI sidebar or the')
log('    MCP `add_project` tool (point it at any `.dev-team-agent/` dir or project root).')
log('  Registry lives at ~/.dev-team-dashboard/projects.json (override: DEV_TEAM_DASHBOARD_HOME).')
log('  DEV_TEAM_ROOT, if set, is auto-seeded as the default project.')
