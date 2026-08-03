#!/usr/bin/env node
/**
 * Remote dashboard handshake (cc-plugin#39).
 *
 * Materialize remote config into `.dev-team-agent/orchestrator-remote.json`:
 *   health check → resolve projectId → cache file → print JSON for agent/env.
 *
 * `--remote` only requires serverUrl. projectId is resolved when missing.
 *
 * Usage:
 *   node resolve-remote.mjs --dev-team-root .dev-team-agent \
 *     [--server=<url>] [--project=<id>] [--project-name=<name>] \
 *     [--api-token=<token>] [--runner-mode=local|remote] [--no-write]
 *
 * Precedence (high → low): CLI flags → orchestrator-remote.json → env DEV_TEAM_*.
 * Exit 0 on success; exit 1 with project list when resolve fails.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out[key] = next
      i++
    } else {
      out[key] = true
    }
  }
  return out
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function authHeaders(token) {
  const auth = token || process.env.DEV_TEAM_API_TOKEN?.trim()
  if (!auth) return {}
  return { Authorization: `Bearer ${auth}`, 'X-Dev-Team-Token': auth }
}

function normalizeGitUrlForMatch(urlStr) {
  const trimmed = (urlStr || '').trim()
  if (!trimmed) return null
  const scp = trimmed.match(/^git@([^:]+):(.+)$/i)
  if (scp) {
    const host = scp[1].toLowerCase()
    const repoPath = scp[2].replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
    return `${host}/${repoPath}`.toLowerCase()
  }
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
    const u = new URL(withScheme)
    const host = u.hostname.toLowerCase()
    const repoPath = u.pathname.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '')
    if (!host || !repoPath) return null
    return `${host}/${repoPath}`.toLowerCase()
  } catch {
    return null
  }
}

function findGitRoot(startDir) {
  let dir = path.resolve(startDir)
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function runGit(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) return null
  return (r.stdout || '').trim()
}

function detectLocalGit(devTeamRoot) {
  const gitRoot = findGitRoot(devTeamRoot)
  if (!gitRoot) return { gitUrl: null, branch: null }
  const gitUrl = runGit(['remote', 'get-url', 'origin'], gitRoot)
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot)
  return { gitUrl, branch: branch === 'HEAD' ? null : branch }
}

function formatProjectTable(projects) {
  const rows = projects.map((p) => ({
    id: p.id,
    name: p.name,
    branch: p.source?.branch || p.branch || '—',
    url: p.source?.url || p.url || '—',
  }))
  const lines = ['id | name | branch | url', '---|---|---|---']
  for (const r of rows) {
    lines.push(`${r.id} | ${r.name} | ${r.branch} | ${r.url}`)
  }
  return lines.join('\n')
}

function projectSummary(p) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    default: Boolean(p.default),
    source: p.source
      ? { url: p.source.url, branch: p.source.branch ?? null }
      : null,
  }
}

async function apiGet(serverUrl, pathname, token) {
  const base = serverUrl.replace(/\/$/, '')
  const url = `${base}${pathname}`
  const res = await fetch(url, { headers: authHeaders(token) })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, data }
}

async function healthCheck(serverUrl, token) {
  const { status, ok, data } = await apiGet(serverUrl, '/api/health', token)
  if (!ok || data.ok !== true) {
    throw new Error(`health check failed: HTTP ${status} ${JSON.stringify(data)}`.slice(0, 300))
  }
  return data
}

async function listProjects(serverUrl, token) {
  const { status, ok, data } = await apiGet(serverUrl, '/api/projects', token)
  if (!ok) {
    throw new Error(`list projects failed: HTTP ${status} ${JSON.stringify(data)}`.slice(0, 300))
  }
  return {
    projects: data.projects || [],
    defaultId: data.defaultId ?? null,
  }
}

async function resolveById(serverUrl, projectId, token) {
  const { status, ok, data } = await apiGet(
    serverUrl,
    `/api/projects?id=${encodeURIComponent(projectId)}`,
    token,
  )
  if (ok && data.project) {
    return { project: data.project, resolvedBy: 'projectId' }
  }
  // Fallback: list and find (older servers may not support ?id=)
  const { projects } = await listProjects(serverUrl, token)
  const project = projects.find((p) => p.id === projectId)
  if (project) return { project, resolvedBy: 'projectId' }
  const err = new Error(`projectId not found on server: ${projectId}`)
  err.candidates = projects
  err.status = status
  throw err
}

async function resolveByName(serverUrl, projectName, token) {
  const { status, ok, data } = await apiGet(
    serverUrl,
    `/api/projects?name=${encodeURIComponent(projectName)}`,
    token,
  )
  if (ok && Array.isArray(data.projects)) {
    if (data.projects.length === 1) {
      return { project: data.projects[0], resolvedBy: 'projectName' }
    }
    if (data.projects.length > 1) {
      const err = new Error(`multiple projects named "${projectName}" — pick one id`)
      err.candidates = data.projects
      throw err
    }
  }

  // Client-side fallback when server has no ?name= filter
  const { projects } = await listProjects(serverUrl, token)
  const matches = projects.filter((p) => p.name === projectName)
  if (matches.length === 1) return { project: matches[0], resolvedBy: 'projectName' }
  if (matches.length > 1) {
    const err = new Error(`multiple projects named "${projectName}" — pick one id`)
    err.candidates = matches
    throw err
  }
  const err = new Error(`no project named "${projectName}"`)
  err.candidates = projects
  err.status = status
  throw err
}

async function resolveByGit(serverUrl, gitUrl, branch, token) {
  const qs = new URLSearchParams({ gitUrl })
  if (branch) qs.set('branch', branch)
  const { status, ok, data } = await apiGet(
    serverUrl,
    `/api/projects/resolve?${qs.toString()}`,
    token,
  )
  if (ok && data.project) {
    return { project: data.project, resolvedBy: data.resolvedBy || 'gitUrl' }
  }
  if (status === 409 && data.candidates?.length) {
    const err = new Error(data.error || 'multiple projects match gitUrl')
    err.candidates = data.candidates
    throw err
  }

  // Client-side fallback
  const { projects } = await listProjects(serverUrl, token)
  const want = normalizeGitUrlForMatch(gitUrl)
  if (!want) {
    const err = new Error('invalid local git remote URL')
    err.candidates = projects
    throw err
  }
  const urlMatches = projects.filter((p) => {
    if (!p.source?.url) return false
    return normalizeGitUrlForMatch(p.source.url) === want
  })

  if (branch) {
    const branchMatches = urlMatches.filter((p) => (p.source?.branch || '') === branch)
    if (branchMatches.length === 1) {
      return { project: branchMatches[0], resolvedBy: 'gitUrl+branch' }
    }
    if (branchMatches.length > 1) {
      const err = new Error('multiple projects match gitUrl+branch — pick one id')
      err.candidates = branchMatches.map(projectSummary)
      throw err
    }
    // Branch miss: unique URL match is enough (feature branch → registered branch).
    if (urlMatches.length === 1) {
      return { project: urlMatches[0], resolvedBy: 'gitUrl' }
    }
    if (urlMatches.length > 1) {
      const err = new Error(
        `no project matches branch "${branch}"; multiple projects share gitUrl — pick one id`,
      )
      err.candidates = urlMatches.map(projectSummary)
      throw err
    }
  } else if (urlMatches.length === 1) {
    return { project: urlMatches[0], resolvedBy: 'gitUrl' }
  } else if (urlMatches.length > 1) {
    const err = new Error('multiple projects match gitUrl — pick one id')
    err.candidates = urlMatches.map(projectSummary)
    throw err
  }

  // Only auto-pick when the server has exactly one project
  if (projects.length === 1) {
    return { project: projects[0], resolvedBy: 'single' }
  }

  const err = new Error('could not resolve project from git remote')
  err.candidates = projects.map(projectSummary)
  err.status = status
  throw err
}

async function resolveProject({ serverUrl, projectId, projectName, token, devTeamRoot }) {
  if (projectId) {
    return resolveById(serverUrl, projectId, token)
  }
  if (projectName) {
    return resolveByName(serverUrl, projectName, token)
  }

  const { gitUrl, branch } = detectLocalGit(devTeamRoot)
  if (gitUrl) {
    try {
      return await resolveByGit(serverUrl, gitUrl, branch, token)
    } catch (err) {
      // Related candidates exist (ambiguous or wrong branch) — do not guess.
      if (err.candidates?.length) throw err
    }
  }

  // Only auto-pick when the server has exactly one project.
  // Do not use defaultId when multiple projects exist (default may be unrelated).
  const { projects } = await listProjects(serverUrl, token)
  if (projects.length === 1) {
    return { project: projects[0], resolvedBy: 'single' }
  }

  const err = new Error(
    'could not resolve project — pass --project=<id> or --project-name=<name>',
  )
  err.candidates = projects.map(projectSummary)
  throw err
}

function loadExistingConfig(configPath) {
  const existing = readJson(configPath)
  return existing && typeof existing === 'object' ? existing : {}
}

function mergeConfig(args, existing) {
  const serverUrl = (
    args.server ||
    existing.serverUrl ||
    process.env.DEV_TEAM_SERVER_URL ||
    ''
  ).trim()
  const projectId = (
    args.project ||
    existing.projectId ||
    process.env.DEV_TEAM_PROJECT_ID ||
    ''
  ).trim() || null
  const projectName = (
    args['project-name'] ||
    existing.projectName ||
    process.env.DEV_TEAM_PROJECT_NAME ||
    ''
  ).trim() || null
  const apiToken = args['api-token'] || existing.apiToken || null
  const runnerMode = args['runner-mode'] || existing.runnerMode || 'local'
  const runnerId = args.runner || existing.runnerId || null

  return {
    serverUrl,
    projectId,
    projectName,
    apiToken,
    runnerMode,
    runnerId,
    syncAfterState: existing.syncAfterState !== false,
    syncAfterStep: existing.syncAfterStep !== false,
    syncMessage: existing.syncMessage || 'chore(dev-team): sync orchestrator artifacts',
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const devTeamRoot = path.resolve(args['dev-team-root'] || '.dev-team-agent')
  const configPath = path.join(devTeamRoot, 'orchestrator-remote.json')
  const existing = loadExistingConfig(configPath)
  const merged = mergeConfig(args, existing)
  const noWrite = args['no-write'] === true

  if (!merged.serverUrl) {
    console.error(
      'missing serverUrl — pass --server=<url>, set DEV_TEAM_SERVER_URL, or write orchestrator-remote.json',
    )
    console.error('When using --remote, serverUrl is required. Do not fall back to local-only.')
    process.exit(1)
  }

  const health = await healthCheck(merged.serverUrl, merged.apiToken)
  console.error(`health ok: version=${health.version || '?'} env=${health.env || '?'}`)

  let resolved
  try {
    resolved = await resolveProject({
      serverUrl: merged.serverUrl,
      projectId: merged.projectId,
      projectName: merged.projectName,
      token: merged.apiToken,
      devTeamRoot,
    })
  } catch (err) {
    console.error(err.message || err)
    if (err.candidates?.length) {
      console.error('\nProjects on server:')
      console.error(formatProjectTable(err.candidates))
    }
    process.exit(1)
  }

  const project = resolved.project
  const out = {
    serverUrl: merged.serverUrl.replace(/\/$/, ''),
    projectId: project.id,
    projectName: project.name,
    apiToken: merged.apiToken,
    runnerMode: merged.runnerMode,
    runnerId: merged.runnerId,
    syncAfterState: merged.syncAfterState,
    syncAfterStep: merged.syncAfterStep,
    syncMessage: merged.syncMessage,
    resolvedAt: new Date().toISOString(),
    resolvedBy: resolved.resolvedBy,
  }

  if (!noWrite) {
    fs.mkdirSync(devTeamRoot, { recursive: true })
    // Preserve unknown keys from existing config
    const written = { ...existing, ...out }
    fs.writeFileSync(configPath, `${JSON.stringify(written, null, 2)}\n`, 'utf8')
    console.error(`wrote ${configPath}`)
  }

  // Machine-readable result on stdout (agent can parse / export env)
  console.log(JSON.stringify(out, null, 2))
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
