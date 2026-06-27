import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { createRegistryContext } from './registry.js'
import { handleKnowledgeApi } from './knowledge/knowledgeApi.js'
import {
  listRunners,
  upsertRunner,
  deleteRunner,
  setDefaultRunner,
  listCredentials,
  upsertCredential,
  deleteCredential,
  submitJob,
  loadJob,
  listJobs,
  cancelJob,
  listProviderIds,
} from './runners/index.js'
import {
  parseAgentMarkdown,
  compileAgentMarkdown,
  draftFromAgentMarkdown,
} from '../shared/agentMarkdown.js'
import { parseFrontmatter } from '../shared/frontmatter.js'
import { homeDir, safeReadDir, statSafe, readYamlSafe } from '../shared/fs.js'
import { json } from '../shared/http.js'
import {
  sanitiseProfileName,
  sanitiseAgentName,
  resolveArtifact,
} from '../shared/sanitize.js'
import {
  buildCatalog,
  parseCatalogAgentId,
  resolveCatalogAgentPath,
} from './catalog/index.js'
import { buildRules } from './rules/index.js'
import {
  profilesDir,
  customAgentsDir,
  agentTemplatesDir,
  workflowStepTemplatesDir,
  scanCustomAgents,
  listCustomAgentMeta,
  readCustomAgent,
  fetchUrlSafe,
  generateDraftFromNl,
  ensureDefaultTemplate,
} from './agents/index.js'

// Vite plugin: exposes a tiny read-only API over the `.dev-team-agent/` data
// root so the dashboard can render orchestrator state without a separate server
// process. Everything is filesystem-backed; the frontend polls for realtime.
//
//   GET /api/tasks                  → all tasks with state + artifact metadata + qa
//   GET /api/artifact?id=..&name=.. → raw text of one artifact (markdown)
//   GET /api/pipeline-config?id=..  → resolved pipeline config (built-in ← global ← per-task)
//   GET /api/pipeline-export?id=..  → structured phase-summary JSON (machine-readable)
//   GET /api/profile                → orchestrator flow profile (future: editable)
//   POST /api/profile               → persist profile (stub)

// Last-resort fallback when NO pipeline.yaml exists anywhere (rare: /dev-dashboard
// setup always scaffolds .dev-team-agent/pipeline.yaml). The canonical source of
// the default flow is dev-team-orchestrator/assets/pipeline.default.yaml — this
// JS literal is a self-contained copy because the viewer is copied out of the
// plugin tree into the project and can't read that asset at runtime. Keep the two
// in sync (only the structure matters here; comments live in the YAML).
const DEFAULT_PIPELINE = {
  version: 1,
  defaults: { review_retry_max: 2, auto_review: false, export_json: false },
  steps: [
    { id: 'investigator', name: 'Investigate', agent: 'dev-agent-teams:investigator', produces: ['investigate.md'], export_key: 'investigator', hitl: { mode: 'manual', gate_id: 'hitl-1', optional_doc_review: true } },
    { id: 'designer', name: 'Design', agent: 'dev-agent-teams:designer', produces: ['design.md'], export_key: 'designer', hitl: { mode: 'manual', gate_id: 'hitl-2', optional_doc_review: true } },
    { id: 'implementer', name: 'Implement', agent: 'dev-agent-teams:implementer', produces: ['phpstan.md'], export_key: 'implementer', hitl: { mode: 'none' } },
    { id: 'reviewer', name: 'Review', agent: 'dev-agent-teams:reviewer', produces: ['review.md', 'test-spec.md'], export_key: 'reviewer', hitl: { mode: 'manual', gate_id: 'hitl-3', blocking: true, retry: { on: 'must_fix', restart_from: 'implementer', max: 2 } } },
    { id: 'pr-creator', name: 'PR', agent: 'dev-agent-teams:pr-creator', produces: ['pr-desc.md'], export_key: 'pr_creator', hitl: { mode: 'none' } },
  ],
  doc_reviewer: { agent: 'dev-agent-teams:doc-reviewer', skills: ['doc-review'], rule_category: 'doc-review', rule_required: true },
}

// Merge one step's fields onto a base step (one level deep for `hitl`).
function mergeStep(base, patch) {
  const out = { ...base, ...patch }
  if (base.hitl || patch.hitl) out.hitl = { ...(base.hitl || {}), ...(patch.hitl || {}) }
  return out
}

// Per-task patch: override by `id`, append new ids, drop on `remove: true`.
function patchSteps(baseSteps, patch) {
  const out = baseSteps.map((s) => ({ ...s }))
  for (const p of patch) {
    const idx = out.findIndex((s) => s.id === p.id)
    if (p.remove) {
      if (idx >= 0) out.splice(idx, 1)
      continue
    }
    if (idx >= 0) out[idx] = mergeStep(out[idx], p)
    else out.push(p)
  }
  return out
}

// Editor saves a full per-task pipeline (steps_replace: true). Hand-written overrides
// patch by step.id unless every per-task id is new (disjoint from base).
function perTaskStepsReplace(baseSteps, per) {
  if (per.steps_replace === true) return true
  if (!Array.isArray(per.steps) || per.steps.length === 0) return false
  const baseIds = new Set(baseSteps.map((s) => s.id))
  return !per.steps.some((s) => s.id && baseIds.has(s.id))
}

// Resolve pipeline config: built-in default ← global pipeline.yaml (full step
// replace) ← per-task tasks/<id>/pipeline.yaml (patch by id, or full replace).
async function loadPipelineConfig(root, id) {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_PIPELINE))
  let source = 'builtin'

  const global = await readYamlSafe(path.join(root, 'pipeline.yaml'))
  if (global) {
    if (Array.isArray(global.steps)) cfg.steps = global.steps
    if (global.defaults) cfg.defaults = { ...cfg.defaults, ...global.defaults }
    if (global.doc_reviewer) cfg.doc_reviewer = { ...cfg.doc_reviewer, ...global.doc_reviewer }
    if (global.version != null) cfg.version = global.version
    source = 'global'
  }

  if (id) {
    const per = await readYamlSafe(path.join(root, 'tasks', id, 'pipeline.yaml'))
    if (per) {
      if (Array.isArray(per.steps)) {
        if (perTaskStepsReplace(cfg.steps, per)) {
          cfg.steps = per.steps
          source = source === 'global' ? 'global+task-replace' : 'task-replace'
        } else {
          cfg.steps = patchSteps(cfg.steps, per.steps)
          source = source === 'global' ? 'global+task' : 'task'
        }
      }
      if (per.defaults) cfg.defaults = { ...cfg.defaults, ...per.defaults }
      if (per.doc_reviewer) cfg.doc_reviewer = { ...cfg.doc_reviewer, ...per.doc_reviewer }
    }
  }

  cfg.source = source
  return cfg
}

// Artifacts a pipeline config produces, plus always-present sidecar files
// (qa.md, and *-po.md doc-review outputs for any *.md artifact).
function knownArtifactsFor(cfg) {
  const set = new Set(['qa.md'])
  for (const step of cfg.steps || []) {
    for (const a of step.produces || []) {
      set.add(a)
      const m = /^(.*)\.md$/.exec(a)
      if (m) set.add(`${m[1]}-po.md`)
    }
  }
  return [...set]
}

// pipeline-export.json is machine-readable only — excluded from the UI artifact list.
const MACHINE_FILES = new Set(['pipeline-export.json'])

async function listArtifacts(taskDir, knownArtifacts) {
  const out = {}
  let entries = []
  try {
    entries = await fs.readdir(taskDir, { withFileTypes: true })
  } catch {
    return { artifacts: out, subtasks: [] }
  }
  const subtasks = []
  for (const e of entries) {
    if (e.isDirectory()) {
      subtasks.push(e.name)
      continue
    }
    if (MACHINE_FILES.has(e.name)) continue
    if (e.name.endsWith('.md')) {
      const meta = await statSafe(path.join(taskDir, e.name))
      out[e.name] = { exists: true, mtime: meta.mtime, size: meta.size }
    }
  }
  // Ensure known artifacts always appear (as not-yet-created) for a stable UI.
  for (const name of knownArtifacts) {
    if (!(name in out)) out[name] = { exists: false, mtime: null, size: 0 }
  }
  return { artifacts: out, subtasks }
}

async function readState(stateFile) {
  try {
    const raw = await fs.readFile(stateFile, 'utf8')
    return { ok: true, state: JSON.parse(raw) }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) }
  }
}

async function collectTasks(root) {
  const stateDir = path.join(root, '.dev-state')
  const tasksDir = path.join(root, 'tasks')
  const result = []

  let stateFiles = []
  try {
    stateFiles = (await fs.readdir(stateDir)).filter((f) => f.endsWith('.json'))
  } catch {
    stateFiles = []
  }

  // Build the set of task ids from state files first, then fold in any task
  // directories that have artifacts but no state yet (e.g. legacy / mid-init).
  const ids = new Set(stateFiles.map((f) => f.replace(/\.json$/, '')))
  try {
    for (const e of await fs.readdir(tasksDir, { withFileTypes: true })) {
      if (e.isDirectory()) ids.add(e.name)
    }
  } catch {
    /* no tasks dir yet */
  }

  for (const id of [...ids].sort()) {
    const stateFile = path.join(stateDir, `${id}.json`)
    const stateMeta = await statSafe(stateFile)
    const { ok, state, error } = stateMeta.exists
      ? await readState(stateFile)
      : { ok: false, state: null, error: 'no state file' }

    const taskDir = path.join(tasksDir, id)
    const cfg = await loadPipelineConfig(root, id)
    const { artifacts, subtasks } = await listArtifacts(taskDir, knownArtifactsFor(cfg))

    let qa = null
    let qa_count = 0
    if (artifacts['qa.md'] && artifacts['qa.md'].exists) {
      try {
        qa = await fs.readFile(path.join(taskDir, 'qa.md'), 'utf8')
        // Count Q&A items: each question starts with a level-2 heading "## Q"
        qa_count = (qa.match(/^##\s+Q\d/gm) || []).length
      } catch {
        qa = null
      }
    }

    result.push({
      task_id: id,
      state_ok: ok,
      state_error: ok ? null : error,
      state_mtime: stateMeta.mtime,
      // Spread known state fields with safe defaults so the UI never crashes on
      // a partially-written file.
      parent_task_id: state?.parent_task_id ?? null,
      current_phase: state?.current_phase ?? null,
      hitl_pending: state?.hitl_pending ?? null,
      review_round: state?.review_round ?? 0,
      auto_review: state?.auto_review ?? false,
      doc_review_round: state?.doc_review_round ?? { investigate: 0, design: 0 },
      inherit_from_parent: state?.inherit_from_parent ?? [],
      export_json: state?.export_json ?? false,
      artifacts,
      subtasks,
      pipeline: cfg,
      has_qa: !!(artifacts['qa.md'] && artifacts['qa.md'].exists),
      qa_count,
      qa,
    })
  }
  return result
}

// Resolve an artifact path safely inside tasks/<id>/, blocking traversal.
function flowProfilePath(root, id) {
  return path.join(root, 'flow-profiles', `${id}.json`)
}

// ── Core request handler (shared by Vite middleware + standalone server) ───────
//
// `createApiHandler(ctx)` returns an async (req, res) => boolean handler. It
// returns `true` when it produced a response (the request was an /api/* route)
// and `false` when the request is not an API request (caller should fall
// through to static serving / next middleware).
//
// ctx = { resolveProjectRoot(projectId), registry, defaultRoot }. Each handler
// reads `?project=<id>` and resolves the per-request `.dev-team-agent/` root via
// ctx.resolveProjectRoot, replacing the old frozen `root` closure (design §4.3).
export function createApiHandler(ctx) {
  const { resolveProjectRoot, registry } = ctx

  // Dispatch an /api/* request. Every branch ends with `return json(...)`, and
  // the final fall-through returns a 404 — so this always produces a response.
  async function dispatch(req, res, url) {
    // Resolve the project root for this request. `projectId` may be null
    // (→ default project). Returns null when an explicit id is unknown.
    const projectId = url.searchParams.get('project') || null
    const root = resolveProjectRoot(projectId)
    const profilePath = root ? path.join(root, 'orchestrator-profile.json') : null
    const unknownProject = () => json(res, 404, { error: 'unknown project', project: projectId })

    if (url.pathname.startsWith('/api/knowledge')) {
      if (!root) return unknownProject()
      await handleKnowledgeApi(req, res, url, root)
      return
    }

    // ── Project registry CRUD (no per-project root needed) ───────────────
    if (url.pathname === '/api/projects') {
      if (req.method === 'GET') {
        const id = url.searchParams.get('id')
        if (id) {
          const project = registry.get(id)
          if (!project) return json(res, 404, { error: 'unknown project', id })
          return json(res, 200, { project })
        }
        return json(res, 200, registry.list())
      }
      if (req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        let parsed
        try { parsed = JSON.parse(body || '{}') } catch { return json(res, 400, { error: 'invalid JSON' }) }
        const result = registry.add({ path: parsed.path, name: parsed.name })
        if (!result.ok) return json(res, result.status || 400, { error: result.error })
        return json(res, 201, { project: result.project })
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id') || ''
        const result = registry.remove(id)
        if (!result.ok) return json(res, result.status || 400, { error: result.error })
        return json(res, 200, { removed: true })
      }
      return json(res, 405, { error: 'method not allowed' })
    }

    // ── Runners & credentials (global, not per-project) ─────────────────
    if (url.pathname === '/api/runners') {
      if (req.method === 'GET') {
        return json(res, 200, { ...listRunners(), providers: listProviderIds() })
      }
      if (req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        let parsed
        try { parsed = JSON.parse(body) } catch { return json(res, 400, { error: 'invalid JSON' }) }
        const result = upsertRunner(parsed.runner || parsed)
        if (!result.ok) return json(res, 400, { error: result.error })
        return json(res, 200, { saved: true, runner: result.runner })
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id') || ''
        const result = deleteRunner(id)
        if (!result.ok) return json(res, result.status || 400, { error: result.error })
        return json(res, 200, { deleted: true, id })
      }
      return json(res, 405, { error: 'method not allowed' })
    }

    if (url.pathname === '/api/runners/default' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      let parsed
      try { parsed = JSON.parse(body) } catch { return json(res, 400, { error: 'invalid JSON' }) }
      const result = setDefaultRunner(parsed.id || parsed.runnerId)
      if (!result.ok) return json(res, result.status || 400, { error: result.error })
      return json(res, 200, { defaultRunnerId: result.defaultRunnerId })
    }

    if (url.pathname === '/api/credentials') {
      if (req.method === 'GET') {
        return json(res, 200, { profiles: listCredentials() })
      }
      if (req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        let parsed
        try { parsed = JSON.parse(body) } catch { return json(res, 400, { error: 'invalid JSON' }) }
        const result = upsertCredential(parsed.profile || parsed)
        if (!result.ok) return json(res, 400, { error: result.error })
        return json(res, 200, { saved: true, profile: result.profile })
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id') || ''
        const result = deleteCredential(id)
        if (!result.ok) return json(res, result.status || 400, { error: result.error })
        return json(res, 200, { deleted: true, id })
      }
      return json(res, 405, { error: 'method not allowed' })
    }

    if (url.pathname === '/api/jobs') {
      if (req.method === 'GET') {
        const id = url.searchParams.get('id')
        if (id) {
          const job = loadJob(id)
          if (!job) return json(res, 404, { error: 'not found' })
          return json(res, 200, { job })
        }
        const limit = Number(url.searchParams.get('limit')) || 20
        return json(res, 200, { jobs: listJobs(limit) })
      }
      if (req.method === 'POST') {
        if (!root) return unknownProject()
        let body = ''
        for await (const chunk of req) body += chunk
        let parsed
        try { parsed = JSON.parse(body) } catch { return json(res, 400, { error: 'invalid JSON' }) }
        if (!parsed.agentRef || !parsed.workspace) {
          return json(res, 400, { error: 'agentRef and workspace are required' })
        }
        const projectRoot = path.dirname(root)
        const job = submitJob({
          runnerId: parsed.runnerId,
          agentRef: parsed.agentRef,
          workspace: path.isAbsolute(parsed.workspace)
            ? parsed.workspace
            : path.join(root, parsed.workspace),
          userPrompt: parsed.userPrompt,
          promptRef: parsed.promptRef,
          produces: parsed.produces,
          metadata: {
            projectRoot,
            devTeamRoot: root,
            ...parsed.metadata,
          },
        })
        return json(res, 201, { job })
      }
      return json(res, 405, { error: 'method not allowed' })
    }

    if (url.pathname.startsWith('/api/jobs/') && url.pathname.endsWith('/cancel') && req.method === 'POST') {
      const id = url.pathname.slice('/api/jobs/'.length, -'/cancel'.length)
      const result = cancelJob(id)
      if (!result.ok) return json(res, result.status || 400, { error: result.error })
      return json(res, 200, { cancelled: true, id })
    }

    if (url.pathname.startsWith('/api/jobs/') && req.method === 'GET') {
      const id = url.pathname.slice('/api/jobs/'.length)
      if (!id || id.includes('/')) return json(res, 404, { error: 'not found' })
      const job = loadJob(id)
      if (!job) return json(res, 404, { error: 'not found' })
      return json(res, 200, { job })
    }

    if (url.pathname === '/api/tasks' && req.method === 'GET') {
      if (!root) return unknownProject()
      // Backward-compat: shape is { root, tasks }. When a project was
      // explicitly requested, also surface its id.
      const payload = { root, tasks: await collectTasks(root) }
      if (projectId) payload.project = projectId
      return json(res, 200, payload)
    }

    // Resolved pipeline config for a task (or global when no id).
    if (url.pathname === '/api/pipeline-config' && req.method === 'GET') {
      if (!root) return unknownProject()
      const id = url.searchParams.get('id') || ''
      const cfg = await loadPipelineConfig(root, id || null)
      return json(res, 200, { id: id || null, pipeline: cfg })
    }

    if (url.pathname === '/api/artifact' && req.method === 'GET') {
      if (!root) return unknownProject()
            const id = url.searchParams.get('id') || ''
            const name = url.searchParams.get('name') || ''
            const target = resolveArtifact(root, id, name)
            if (!target) return json(res, 400, { error: 'invalid path' })
            try {
              const content = await fs.readFile(target, 'utf8')
              const s = await fs.stat(target)
              return json(res, 200, { id, name, content, mtime: s.mtimeMs })
            } catch {
              return json(res, 404, { error: 'not found', id, name })
            }
          }

          if (url.pathname === '/api/profile') {
            if (!root) return unknownProject()
            if (req.method === 'GET') {
              try {
                const raw = await fs.readFile(profilePath, 'utf8')
                return json(res, 200, { profile: JSON.parse(raw), exists: true })
              } catch {
                return json(res, 200, { profile: null, exists: false })
              }
            }
            if (req.method === 'POST') {
              return json(res, 501, { error: 'profile editing not implemented yet' })
            }
          }

          // Structured phase-summary export (machine-readable, written by orchestrator
          // when --export-json flag is active).
          if (url.pathname === '/api/pipeline-export' && req.method === 'GET') {
            if (!root) return unknownProject()
            const id = url.searchParams.get('id') || ''
            if (!id) return json(res, 400, { error: 'missing id' })
            const fp = path.join(root, 'tasks', id, 'pipeline-export.json')
            try {
              const raw = await fs.readFile(fp, 'utf8')
              return json(res, 200, { id, export: JSON.parse(raw), exists: true })
            } catch {
              return json(res, 200, { id, export: null, exists: false })
            }
          }

          // Per-task flow profiles: GET reads, POST creates/updates.
          if (url.pathname === '/api/flow-profile') {
            if (!root) return unknownProject()
            const id = url.searchParams.get('id') || ''
            if (!id) return json(res, 400, { error: 'missing id' })
            const fp = flowProfilePath(root, id)

            if (req.method === 'GET') {
              try {
                const raw = await fs.readFile(fp, 'utf8')
                return json(res, 200, { id, profile: JSON.parse(raw), exists: true })
              } catch {
                return json(res, 200, { id, profile: null, exists: false })
              }
            }

            if (req.method === 'POST') {
              let body = ''
              for await (const chunk of req) body += chunk
              let parsed
              try {
                parsed = JSON.parse(body)
              } catch {
                return json(res, 400, { error: 'invalid JSON body' })
              }
              await fs.mkdir(path.dirname(fp), { recursive: true })
              await fs.writeFile(fp, JSON.stringify(parsed, null, 2), 'utf8')
              return json(res, 200, { id, saved: true })
            }
          }

          // ── Catalog: available skills & agents from installed plugins ──────
          if (url.pathname === '/api/catalog' && req.method === 'GET') {
            if (!root) return unknownProject()
            const catalog = await buildCatalog(root, { scanCustomAgents })
            return json(res, 200, catalog)
          }

          if (url.pathname === '/api/catalog-agent' && req.method === 'GET') {
            if (!root) return unknownProject()
            const id = url.searchParams.get('id')
            if (!id) return json(res, 400, { error: 'missing id' })
            const projectRoot = path.dirname(root)
            let agentPath = await resolveCatalogAgentPath(projectRoot, root, id, { customAgentsDir })
            if (!agentPath) {
              const parsed = parseCatalogAgentId(id)
              if (parsed?.source?.startsWith('repo:')) {
                const pluginName = parsed.source.slice('repo:'.length)
                const builtin = path.join(
                  projectRoot,
                  'plugins',
                  pluginName,
                  'agents',
                  `${parsed.name}.md`,
                )
                try {
                  await fs.access(builtin)
                  agentPath = builtin
                } catch {
                  /* not found */
                }
              }
            }
            if (!agentPath) return json(res, 404, { error: 'agent file not found' })
            try {
              const raw = await fs.readFile(agentPath, 'utf8')
              const meta = parseCatalogAgentId(id)
              const draft = draftFromAgentMarkdown(raw, yaml, {
                name: meta?.name,
                description: '',
              })
              const fm = parseFrontmatter(raw)
              if (fm.description) draft.description = fm.description
              if (Array.isArray(fm.skills) && fm.skills.length) draft.skills = [...fm.skills]
              return json(res, 200, { id, path: agentPath, content: raw, draft })
            } catch (e) {
              return json(res, 500, { error: String(e.message || e) })
            }
          }

          if (url.pathname === '/api/rules' && req.method === 'GET') {
            if (!root) return unknownProject()
            const rulesData = await buildRules(root)
            return json(res, 200, rulesData)
          }

          // ── Pipeline profiles: named reusable pipeline configs ────────────
          if (url.pathname === '/api/pipeline-profiles') {
            if (!root) return unknownProject()
            const dir = profilesDir(root)

            if (req.method === 'GET') {
              // ?name=<n> → return one profile's pipeline content
              const nameParam = url.searchParams.get('name')
              if (nameParam) {
                const name = sanitiseProfileName(nameParam)
                if (!name) return json(res, 400, { error: 'invalid profile name' })
                try {
                  const raw = await fs.readFile(path.join(dir, `${name}.yaml`), 'utf8')
                  const pipeline = yaml.load(raw)
                  return json(res, 200, { name, pipeline })
                } catch {
                  return json(res, 404, { error: 'profile not found' })
                }
              }
              // No ?name → list all profiles
              try {
                const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.yaml'))
                const profiles = await Promise.all(
                  files.map(async (f) => {
                    const s = await statSafe(path.join(dir, f))
                    return { name: f.replace(/\.yaml$/, ''), mtime: s.mtime }
                  }),
                )
                return json(res, 200, { profiles })
              } catch {
                return json(res, 200, { profiles: [] })
              }
            }

            if (req.method === 'POST') {
              let body = ''
              for await (const chunk of req) body += chunk
              let parsed
              try { parsed = JSON.parse(body) } catch { return json(res, 400, { error: 'invalid JSON' }) }
              const name = sanitiseProfileName(parsed.name)
              if (!name) return json(res, 400, { error: 'invalid profile name' })
              if (!parsed.pipeline || !Array.isArray(parsed.pipeline.steps)) {
                return json(res, 400, { error: 'pipeline.steps must be an array' })
              }
              await fs.mkdir(dir, { recursive: true })
              await fs.writeFile(path.join(dir, `${name}.yaml`), yaml.dump(parsed.pipeline, { lineWidth: 120 }), 'utf8')
              return json(res, 200, { saved: true, name })
            }

            if (req.method === 'DELETE') {
              const name = sanitiseProfileName(url.searchParams.get('name') || '')
              if (!name) return json(res, 400, { error: 'invalid profile name' })
              try {
                await fs.unlink(path.join(dir, `${name}.yaml`))
                return json(res, 200, { deleted: true, name })
              } catch {
                return json(res, 404, { error: 'profile not found' })
              }
            }
          }

          // ── Pipeline config write: save global or per-task pipeline.yaml ──
          if (url.pathname === '/api/pipeline-config-write' && req.method === 'POST') {
            if (!root) return unknownProject()
            let body = ''
            for await (const chunk of req) body += chunk
            let parsed
            try { parsed = JSON.parse(body) } catch { return json(res, 400, { error: 'invalid JSON' }) }
            const { scope, taskId, pipeline } = parsed
            if (!pipeline || !Array.isArray(pipeline.steps)) {
              return json(res, 400, { error: 'pipeline.steps must be an array' })
            }
            let target
            if (scope === 'global') {
              target = path.join(root, 'pipeline.yaml')
            } else if (scope === 'task' && taskId) {
              // Sanitise taskId — only allow alphanumeric and hyphens/underscores
              if (/[^\w\-]/.test(taskId)) return json(res, 400, { error: 'invalid taskId' })
              const taskDir = path.join(root, 'tasks', taskId)
              await fs.mkdir(taskDir, { recursive: true })
              target = path.join(taskDir, 'pipeline.yaml')
            } else {
              return json(res, 400, { error: 'scope must be "global" or "task" (with taskId)' })
            }
            const toWrite =
              scope === 'task'
                ? { ...pipeline, steps_replace: true }
                : pipeline
            await fs.writeFile(target, yaml.dump(toWrite, { lineWidth: 120 }), 'utf8')
            return json(res, 200, { written: true, scope, target })
          }

          // ── Custom agents (dashboard-created) ─────────────────────────────
          if (url.pathname === '/api/custom-agents') {
            if (!root) return unknownProject()
            if (req.method === 'GET') {
              const name = url.searchParams.get('name')
              if (name) {
                const agent = await readCustomAgent(root, name)
                if (!agent) return json(res, 404, { error: 'not found' })
                return json(res, 200, agent)
              }
              const agents = await listCustomAgentMeta(root)
              return json(res, 200, { agents })
            }
            if (req.method === 'POST') {
              let body = ''
              for await (const chunk of req) body += chunk
              let parsed
              try { parsed = JSON.parse(body) } catch { return json(res, 400, { error: 'invalid JSON' }) }
              const draft = parsed.draft || parsed
              const clean = sanitiseAgentName(draft.name)
              if (!clean) return json(res, 400, { error: 'invalid agent name' })
              await fs.mkdir(customAgentsDir(root), { recursive: true })
              const content = compileAgentMarkdown({ ...draft, name: clean }, yaml)
              await fs.writeFile(path.join(customAgentsDir(root), `${clean}.md`), content, 'utf8')
              return json(res, 200, { saved: true, name: clean })
            }
            if (req.method === 'DELETE') {
              const name = sanitiseAgentName(url.searchParams.get('name') || '')
              if (!name) return json(res, 400, { error: 'invalid name' })
              try {
                await fs.unlink(path.join(customAgentsDir(root), `${name}.md`))
                return json(res, 200, { deleted: true, name })
              } catch {
                return json(res, 404, { error: 'not found' })
              }
            }
          }

          if (url.pathname === '/api/custom-agents/export' && req.method === 'POST') {
            if (!root) return unknownProject()
            let body = ''
            for await (const chunk of req) body += chunk
            let parsed
            try { parsed = JSON.parse(body) } catch { return json(res, 400, { error: 'invalid JSON' }) }
            const name = sanitiseAgentName(parsed.name)
            if (!name) return json(res, 400, { error: 'invalid name' })
            const agent = await readCustomAgent(root, name)
            if (!agent) return json(res, 404, { error: 'agent not found' })
            const projectRoot = path.dirname(root)
            const exportDir = path.join(projectRoot, '.claude', 'agents')
            await fs.mkdir(exportDir, { recursive: true })
            const dest = path.join(exportDir, `${name}.md`)
            if (!parsed.overwrite) {
              try {
                await fs.access(dest)
                return json(res, 409, { error: 'file exists', path: `.claude/agents/${name}.md` })
              } catch { /* ok */ }
            }
            await fs.writeFile(dest, agent.content, 'utf8')
            return json(res, 200, { exported: true, path: `.claude/agents/${name}.md` })
          }

          if (url.pathname === '/api/custom-agents/generate' && req.method === 'POST') {
            if (!root) return unknownProject()
            let body = ''
            for await (const chunk of req) body += chunk
            let parsed
            try { parsed = JSON.parse(body) } catch { return json(res, 400, { error: 'invalid JSON' }) }
            const draft = await generateDraftFromNl(parsed.description || '')
            return json(res, 200, { draft })
          }

          // ── Agent templates ───────────────────────────────────────────────
          if (url.pathname === '/api/agent-templates') {
            if (!root) return unknownProject()
            await ensureDefaultTemplate(root)
            const tplDir = agentTemplatesDir(root)
            if (req.method === 'GET') {
              const name = url.searchParams.get('name')
              if (name) {
                const clean = sanitiseAgentName(name) || sanitiseProfileName(name)
                if (!clean) return json(res, 400, { error: 'invalid name' })
                try {
                  const raw = await fs.readFile(path.join(tplDir, `${clean}.md`), 'utf8')
                  const draft = parseAgentMarkdown(raw, yaml)
                  return json(res, 200, { name: clean, content: raw, draft })
                } catch {
                  return json(res, 404, { error: 'not found' })
                }
              }
              const templates = []
              for (const entry of await safeReadDir(tplDir)) {
                if (!entry.isFile() || !entry.name.endsWith('.md')) continue
                const n = entry.name.replace(/\.md$/, '')
                try {
                  const raw = await fs.readFile(path.join(tplDir, entry.name), 'utf8')
                  const d = parseAgentMarkdown(raw, yaml)
                  templates.push({ name: n, description: d.description || '' })
                } catch {
                  templates.push({ name: n, description: '' })
                }
              }
              return json(res, 200, { templates: templates.sort((a, b) => a.name.localeCompare(b.name)) })
            }
            if (req.method === 'POST') {
              const ctype = req.headers['content-type'] || ''
              if (ctype.includes('multipart/form-data')) {
                let body = ''
                for await (const chunk of req) body += chunk
                const boundary = ctype.split('boundary=')[1]
                if (!boundary) return json(res, 400, { error: 'missing boundary' })
                const parts = body.split(`--${boundary}`)
                let fileContent = ''
                let fileName = 'uploaded-template'
                for (const part of parts) {
                  if (part.includes('filename=')) {
                    const fnMatch = /filename="([^"]+)"/.exec(part)
                    if (fnMatch) fileName = fnMatch[1].replace(/\.md$/i, '')
                    const idx = part.indexOf('\r\n\r\n')
                    if (idx >= 0) fileContent = part.slice(idx + 4).replace(/\r\n--$/, '').trim()
                  }
                }
                if (!fileContent) return json(res, 400, { error: 'no file content' })
                const clean = sanitiseAgentName(fileName) || 'uploaded-template'
                await fs.mkdir(tplDir, { recursive: true })
                await fs.writeFile(path.join(tplDir, `${clean}.md`), fileContent, 'utf8')
                return json(res, 200, { saved: true, name: clean })
              }
              let body = ''
              for await (const chunk of req) body += chunk
              let parsed
              try { parsed = JSON.parse(body) } catch { return json(res, 400, { error: 'invalid JSON' }) }
              if (parsed.url) {
                let text
                try {
                  text = await fetchUrlSafe(parsed.url)
                } catch (e) {
                  return json(res, 400, { error: String(e.message || e) })
                }
                const draft = parseAgentMarkdown(text, yaml)
                const clean = sanitiseAgentName(parsed.name || draft.name || 'url-template') || 'url-template'
                await fs.mkdir(tplDir, { recursive: true })
                await fs.writeFile(path.join(tplDir, `${clean}.md`), text, 'utf8')
                return json(res, 200, { saved: true, name: clean, draft })
              }
              const draft = parsed.draft || parsed
              const clean = sanitiseAgentName(draft.name || parsed.name)
              if (!clean) return json(res, 400, { error: 'invalid template name' })
              await fs.mkdir(tplDir, { recursive: true })
              const content = compileAgentMarkdown(draft, yaml)
              await fs.writeFile(path.join(tplDir, `${clean}.md`), content, 'utf8')
              return json(res, 200, { saved: true, name: clean })
            }
            if (req.method === 'DELETE') {
              const name = sanitiseAgentName(url.searchParams.get('name') || '') || sanitiseProfileName(url.searchParams.get('name') || '')
              if (!name) return json(res, 400, { error: 'invalid name' })
              try {
                await fs.unlink(path.join(tplDir, `${name}.md`))
                return json(res, 200, { deleted: true, name })
              } catch {
                return json(res, 404, { error: 'not found' })
              }
            }
          }

          // ── Workflow step templates (builder) ─────────────────────────────
          if (url.pathname === '/api/workflow-step-templates') {
            if (!root) return unknownProject()
            const tplDir = workflowStepTemplatesDir(root)
            if (req.method === 'GET') {
              const name = url.searchParams.get('name')
              if (name) {
                const clean = sanitiseAgentName(name)
                if (!clean) return json(res, 400, { error: 'invalid name' })
                try {
                  const raw = await fs.readFile(path.join(tplDir, `${clean}.json`), 'utf8')
                  return json(res, 200, { name: clean, template: JSON.parse(raw) })
                } catch {
                  return json(res, 404, { error: 'not found' })
                }
              }
              await fs.mkdir(tplDir, { recursive: true })
              const templates = []
              for (const entry of await safeReadDir(tplDir)) {
                if (!entry.isFile() || !entry.name.endsWith('.json')) continue
                const n = entry.name.replace(/\.json$/, '')
                try {
                  const raw = await fs.readFile(path.join(tplDir, entry.name), 'utf8')
                  const t = JSON.parse(raw)
                  templates.push({ name: n, title: t.title || n })
                } catch {
                  templates.push({ name: n, title: n })
                }
              }
              return json(res, 200, { templates: templates.sort((a, b) => a.name.localeCompare(b.name)) })
            }
            if (req.method === 'POST') {
              let body = ''
              for await (const chunk of req) body += chunk
              let parsed
              try { parsed = JSON.parse(body) } catch { return json(res, 400, { error: 'invalid JSON' }) }
              const template = parsed.template || parsed
              const clean = sanitiseAgentName(template.name || parsed.name)
              if (!clean) return json(res, 400, { error: 'invalid template name' })
              const payload = {
                name: clean,
                title: template.title || clean,
                body: template.body || '',
                pipeline_step_id: template.pipeline_step_id || '',
              }
              await fs.mkdir(tplDir, { recursive: true })
              await fs.writeFile(path.join(tplDir, `${clean}.json`), JSON.stringify(payload, null, 2), 'utf8')
              return json(res, 200, { saved: true, name: clean })
            }
            if (req.method === 'DELETE') {
              const name = sanitiseAgentName(url.searchParams.get('name') || '')
              if (!name) return json(res, 400, { error: 'invalid name' })
              try {
                await fs.unlink(path.join(tplDir, `${name}.json`))
                return json(res, 200, { deleted: true, name })
              } catch {
                return json(res, 404, { error: 'not found' })
              }
            }
          }

          return json(res, 404, { error: 'unknown endpoint' })
  }

  // Public handler: returns true when it handled an /api/* request, false to
  // let the caller fall through (static files / next middleware).
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost')
    if (!url.pathname.startsWith('/api/')) return false
    try {
      await dispatch(req, res, url)
    } catch (err) {
      json(res, 500, { error: String(err && err.message ? err.message : err) })
    }
    return true
  }
}

// Vite plugin wrapper around the shared core handler. Builds a ctx whose
// default project root is the legacy `root` (cwd/.. or DEV_TEAM_ROOT), then
// serves /api/* through createApiHandler — so dev mode behaves exactly as
// before while gaining multi-project support via `?project=`.
export function devTeamApi({ root }) {
  const ctx = createRegistryContext({ defaultRoot: root })
  const apiHandler = createApiHandler(ctx)

  return {
    name: 'dev-team-api',
    configureServer(server) {
      // Surface the resolved default root once at startup.
      const exists = fsSync.existsSync(root)
      server.config.logger.info(
        `\n  dev-team-dashboard → default root: ${root}${exists ? '' : '  (does not exist yet)'}\n`,
      )

      server.middlewares.use(async (req, res, next) => {
        const handled = await apiHandler(req, res)
        if (!handled) return next()
      })
    },
  }
}
