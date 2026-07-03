#!/usr/bin/env bun
import { triggerServerSync } from '../server/git/push.js'
import { get, pushGitWorkspace } from '../server/registry.js'

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

async function main() {
  const projectId = parseRequired('--project=')
  const project = get(projectId)
  if (!project) {
    console.error(`unknown project: ${projectId}`)
    process.exit(1)
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
