#!/usr/bin/env node
/**
 * Submit orchestrator agent jobs to a remote dev-team-dashboard (Luồng A / C).
 * Falls back to local runner-cli.mjs when --local is set or server unreachable.
 *
 * Usage:
 *   node remote-runner-cli.mjs submit \
 *     --server https://dashboard.example.com \
 *     --project my-repo \
 *     --agent investigator \
 *     --workspace tasks/U0003 \
 *     --prompt-file .dev-team-agent/tasks/U0003/.prompt-investigate.txt \
 *     --produces investigate.md \
 *     --task-id U0003 --step-id investigate \
 *     --wait
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function dashboardAppRoot() {
  const override = process.env.DEV_TEAM_DASHBOARD_APP?.trim()
  if (override) return path.resolve(override.replace(/^~/, os.homedir()))
  return path.join(os.homedir(), '.dev-team-dashboard', 'app')
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        out[key] = next
        i++
      } else {
        out[key] = true
      }
    } else {
      out._.push(a)
    }
  }
  return out
}

function authHeaders(token) {
  const auth = token || process.env.DEV_TEAM_API_TOKEN?.trim()
  if (!auth) return {}
  return { Authorization: `Bearer ${auth}`, 'X-Dev-Team-Token': auth }
}

async function apiFetch(baseUrl, pathname, { method = 'GET', body, token, projectId } = {}) {
  const base = baseUrl.replace(/\/$/, '')
  const qs = projectId ? `${pathname.includes('?') ? '&' : '?'}project=${encodeURIComponent(projectId)}` : ''
  const url = `${base}${pathname}${qs}`
  const headers = { ...authHeaders(token) }
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `${method} ${pathname} → ${res.status}`)
  }
  return data
}

function requireJob(job, context) {
  if (!job || !job.id) {
    throw new Error(`unexpected response from ${context}: missing job.id`)
  }
  return job
}

function buildForwardArgs(args, excludeKeys = []) {
  const forward = ['submit']
  for (const [k, v] of Object.entries(args)) {
    if (k === '_' || v === true || excludeKeys.includes(k)) continue
    forward.push(`--${k}`, String(v))
  }
  if (args.wait) forward.push('--wait')
  return forward
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function localRunnerCli(args) {
  const cliPath = path.join(dashboardAppRoot(), 'server', 'runner-cli.mjs')
  if (!fs.existsSync(cliPath)) {
    console.error(`runner-cli not found: ${cliPath} — run /dev-dashboard once to clone agent-workflow app`)
    process.exit(1)
  }
  const runner = process.platform === 'win32' ? 'bun.cmd' : 'bun'
  const r = spawnSync(runner, [cliPath, ...args], { encoding: 'utf8' })
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  process.exit(r.status ?? 1)
}

async function submitRemote(args) {
  const server = (args.server || process.env.DEV_TEAM_SERVER_URL || '').trim()
  const projectId = args.project || process.env.DEV_TEAM_PROJECT_ID?.trim()
  if (!server || !projectId) {
    throw new Error('missing --server / DEV_TEAM_SERVER_URL or --project / DEV_TEAM_PROJECT_ID')
  }

  let userPrompt = args.prompt
  if (args['prompt-file']) {
    userPrompt = fs.readFileSync(path.resolve(args['prompt-file']), 'utf8')
  }

  const produces = args.produces
    ? String(args.produces).split(',').map((s) => s.trim()).filter(Boolean)
    : undefined

  const workspace = args.workspace
  const payload = {
    runnerId: args.runner || undefined,
    agentRef: args.agent,
    workspace,
    userPrompt,
    produces,
    metadata: {
      taskId: args['task-id'],
      stepId: args['step-id'],
      projectId,
    },
  }

  const job = requireJob(
    (await apiFetch(server, '/api/jobs', {
      method: 'POST',
      body: payload,
      token: args['api-token'],
      projectId,
    })).job,
    'POST /api/jobs',
  )

  if (!args.wait) {
    console.log(JSON.stringify(job, null, 2))
    return job
  }

  const deadline = Date.now() + (Number(args['max-wait-ms']) || 3_600_000)
  while (Date.now() < deadline) {
    const current = requireJob(
      (await apiFetch(server, `/api/jobs/${encodeURIComponent(job.id)}`, {
        token: args['api-token'],
        projectId,
      })).job,
      `GET /api/jobs/${job.id}`,
    )
    if (current.status === 'succeeded' || current.status === 'failed' || current.status === 'cancelled') {
      console.log(JSON.stringify(current, null, 2))
      process.exit(current.status === 'succeeded' ? 0 : 1)
    }
    await sleep(Number(args['poll-ms']) || 2000)
  }
  throw new Error(`job ${job.id} timed out`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]

  if (cmd === 'status') {
    const server = (args.server || process.env.DEV_TEAM_SERVER_URL || '').trim()
    const projectId = args.project || process.env.DEV_TEAM_PROJECT_ID?.trim()
    if (!server || !projectId) {
      localRunnerCli(['status', '--job', args.job])
    }
    const job = requireJob(
      (await apiFetch(server, `/api/jobs/${encodeURIComponent(args.job)}`, {
        token: args['api-token'],
        projectId,
      })).job,
      `GET /api/jobs/${args.job}`,
    )
    console.log(JSON.stringify(job, null, 2))
    process.exit(job.status === 'succeeded' ? 0 : 1)
  }

  if (cmd !== 'submit') {
    console.error('Usage: remote-runner-cli.mjs submit|status ...')
    process.exit(1)
  }

  if (!args.agent || !args.workspace) {
    console.error('missing --agent and --workspace')
    process.exit(1)
  }

  if (args.local) {
    localRunnerCli(buildForwardArgs(args, ['local', 'server', 'project']))
  }

  try {
    await submitRemote(args)
  } catch (err) {
    if (args['no-fallback']) {
      console.error(err.message || err)
      process.exit(1)
    }
    console.warn(`[remote-runner] ${err.message || err} — falling back to local runner-cli`)
    localRunnerCli(buildForwardArgs(args, ['server', 'project', 'local']))
  }
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
