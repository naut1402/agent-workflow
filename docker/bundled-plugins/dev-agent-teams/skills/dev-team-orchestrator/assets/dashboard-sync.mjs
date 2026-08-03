#!/usr/bin/env node
/**
 * Push .dev-team-agent/ artifacts to git origin and trigger remote dashboard sync.
 * Luồng B — dev runner + server mirror (agent-workflow F0003 / #39).
 *
 * Usage:
 *   node dashboard-sync.mjs --dev-team-root .dev-team-agent [--project=<id>] [--server=<url>] [--message=<msg>] [--no-push]
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const DEFAULT_MESSAGE = 'chore(dev-team): sync orchestrator artifacts'

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

function runGit(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`)
  }
  return (r.stdout || '').trim()
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

function resolveDevTeamRel(devTeamRoot, gitRoot) {
  const rel = path.relative(gitRoot, path.resolve(devTeamRoot)).replace(/\\/g, '/')
  if (!rel || rel.startsWith('..')) {
    throw new Error('dev-team-root is not inside git repository')
  }
  return rel
}

async function triggerServerSync({ serverBaseUrl, projectId, token }) {
  const base = serverBaseUrl.replace(/\/$/, '')
  const qs = projectId ? `?project=${encodeURIComponent(projectId)}` : ''
  const url = `${base}/api/projects/${encodeURIComponent(projectId)}/sync${qs}`
  const headers = {}
  const auth = token || process.env.DEV_TEAM_API_TOKEN?.trim()
  if (auth) {
    headers.Authorization = `Bearer ${auth}`
    headers['X-Dev-Team-Token'] = auth
  }
  const res = await fetch(url, { method: 'POST', headers })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`server sync failed: ${res.status} ${body}`.slice(0, 500))
  }
  return res.json().catch(() => ({}))
}

function loadRemoteConfig(devTeamRoot) {
  const file = path.join(devTeamRoot, 'orchestrator-remote.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const devTeamRoot = path.resolve(args['dev-team-root'] || '.dev-team-agent')
  const remoteCfg = loadRemoteConfig(devTeamRoot)
  // Precedence matches resolve-remote.mjs: CLI → cache → env
  // (env must not override a successful handshake cache).
  const projectId = (
    args.project ||
    remoteCfg.projectId ||
    process.env.DEV_TEAM_PROJECT_ID ||
    ''
  ).trim()
  const serverUrl = (
    args.server ||
    remoteCfg.serverUrl ||
    process.env.DEV_TEAM_SERVER_URL ||
    ''
  ).trim()
  const message = args.message || remoteCfg.syncMessage || DEFAULT_MESSAGE
  const skipPush = args['no-push'] === true

  if (!projectId) {
    console.error(
      'missing projectId — run resolve-remote.mjs first, or pass --project=<id> / DEV_TEAM_PROJECT_ID',
    )
    process.exit(1)
  }
  if (!serverUrl) {
    console.error(
      'missing serverUrl — run resolve-remote.mjs first, or pass --server=<url> / DEV_TEAM_SERVER_URL',
    )
    process.exit(1)
  }

  let pushResult = { pushed: false, branch: null, commit: null }

  if (!skipPush) {
    const gitRoot = findGitRoot(devTeamRoot)
    if (!gitRoot) {
      console.error('dev-team-root is not inside a git repository — use --no-push if sync-only')
      process.exit(1)
    }

    const devTeamRel = resolveDevTeamRel(devTeamRoot, gitRoot)
    runGit(['add', '--', devTeamRel], gitRoot)
    const status = runGit(['status', '--porcelain', '--', devTeamRel], gitRoot)

    if (status) {
      runGit(['commit', '-m', message, '--', devTeamRel], gitRoot)
      const commit = runGit(['rev-parse', 'HEAD'], gitRoot)
      const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot)
      runGit(['push', 'origin', branch], gitRoot)
      pushResult = { pushed: true, branch, commit }
      console.log(`pushed ${commit} to origin/${branch}`)
    } else {
      pushResult.branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot)
      console.log('no changes under .dev-team-agent')
    }
  }

  const sync = await triggerServerSync({
    serverBaseUrl: serverUrl,
    projectId,
    token: args['api-token'] || remoteCfg.apiToken,
  })
  console.log(`${projectId}: server sync OK`, sync.syncedAt ? `@ ${sync.syncedAt}` : '')
  console.log(JSON.stringify({ ok: true, ...pushResult, synced: true }, null, 2))
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
