#!/usr/bin/env bun
import { triggerServerSync } from '../server/git/push.js'
import { get, pushGitWorkspace } from '../server/registry.js'
import { collectArtifactFiles } from '../server/workspace/artifactSync.js'

function parseArg(prefix: string): string | undefined {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length) || undefined
  }
  return undefined
}

function parseRequired(prefix: string): string {
  const value = parseArg(prefix)
  if (!value) {
    console.error(`missing required argument ${prefix}<value>`)
    process.exit(1)
  }
  return value
}

async function pushViaApi(opts: { projectId: string; devTeamRoot: string; syncUrl: string }): Promise<void> {
  const files = collectArtifactFiles(opts.devTeamRoot)
  const base = opts.syncUrl.replace(/\/$/, '')
  const url = `${base}/api/projects/${encodeURIComponent(opts.projectId)}/artifacts`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = process.env.DEV_TEAM_API_TOKEN?.trim()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ files }) })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`artifact sync failed: ${res.status} ${body}`.slice(0, 500))
    process.exit(1)
  }
  const data = (await res.json()) as { filesWritten?: number; filesDeleted?: number }
  console.log(
    `${opts.projectId}: artifact sync OK (written=${data.filesWritten ?? 0}, deleted=${data.filesDeleted ?? 0})`,
  )
}

async function main() {
  const projectId = parseRequired('--project=')
  const project = get(projectId)
  if (!project) {
    console.error(`unknown project: ${projectId}`)
    process.exit(1)
  }

  // `kind: 'api'` — transport HTTP API upload (mặc định cho project mới).
  // `kind: 'git'` — giữ nguyên push git legacy (backward-compat cho project
  // đã đăng ký trước đó).
  if (project.kind === 'api') {
    const syncUrl = parseArg('--sync-server=') ?? process.env.DEV_TEAM_SERVER_URL?.trim()
    if (!syncUrl) {
      console.error('kind "api" requires --sync-server=<url> or DEV_TEAM_SERVER_URL')
      process.exit(1)
    }
    await pushViaApi({ projectId, devTeamRoot: project.path, syncUrl })
    return
  }

  const result = await pushGitWorkspace(projectId, { message: parseArg('--message=') })
  if (!result.ok) {
    console.error('error' in result ? result.error : 'push failed')
    process.exit(1)
  }
  if (result.pushed) {
    console.log(`${projectId}: pushed ${result.commit} to origin/${result.branch}`)
  } else {
    console.log(`${projectId}: no changes under .dev-team-agent`)
  }

  const syncUrl = parseArg('--sync-server=') ?? process.env.DEV_TEAM_SERVER_URL?.trim()
  if (syncUrl) {
    const sync = await triggerServerSync({ serverBaseUrl: syncUrl, projectId })
    if (!sync.ok) {
      console.error(sync.error)
      process.exit(1)
    }
    console.log(`${projectId}: server sync OK`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
