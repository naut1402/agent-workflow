#!/usr/bin/env bun
import { list, syncGitProject } from '../server/registry.js'

function parseProjectArg(): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--project=')) return arg.slice('--project='.length) || null
  }
  return null
}

async function main() {
  const projectId = parseProjectArg()
  const targets = projectId
    ? [{ id: projectId }]
    : list().projects.filter((p) => p.kind === 'git').map((p) => ({ id: p.id }))

  if (!targets.length) {
    console.log(projectId ? `unknown or non-git project: ${projectId}` : 'no git projects to sync')
    process.exit(projectId ? 1 : 0)
  }

  let failed = false
  for (const { id } of targets) {
    const result = await syncGitProject(id)
    if (!result.ok) {
      failed = true
      console.error(`${id}: ${'error' in result ? result.error : 'sync failed'}`)
      continue
    }
    console.log(`${id}: synced at ${result.syncedAt}`)
  }
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
