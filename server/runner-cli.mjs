#!/usr/bin/env node
/**
 * CLI entry for orchestrator — submit agent jobs to JobQueue.
 *
 * Usage:
 *   node runner-cli.mjs submit --agent dev-agent-teams:investigator \
 *     --workspace /path/to/project/.dev-team-agent/tasks/U0005 \
 *     --prompt-file /path/to/prompt.txt --wait
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { submitAndWait, submitJob, loadJob } from './runners/jobQueue.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

function usage() {
  console.error(`Usage:
  runner-cli.mjs submit --agent <ref> --workspace <dir> [--prompt-file <path>] [--prompt <text>] [--runner <id>] [--wait] [--produces a,b]
  runner-cli.mjs status --job <id>`)
  process.exit(1)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]

  if (cmd === 'status') {
    const job = loadJob(args.job)
    if (!job) {
      console.error('job not found')
      process.exit(1)
    }
    console.log(JSON.stringify(job, null, 2))
    process.exit(job.status === 'succeeded' ? 0 : 1)
  }

  if (cmd !== 'submit') usage()

  if (!args.agent || !args.workspace) usage()

  const workspace = path.resolve(args.workspace)
  const projectRoot = args['project-root']
    ? path.resolve(args['project-root'])
    : path.resolve(workspace, '..', '..', '..')

  const devTeamRoot = args['dev-team-root']
    ? path.resolve(args['dev-team-root'])
    : path.resolve(workspace, '..', '..')

  const produces = args.produces
    ? String(args.produces).split(',').map((s) => s.trim()).filter(Boolean)
    : undefined

  const input = {
    runnerId: args.runner,
    agentRef: args.agent,
    workspace,
    userPrompt: args.prompt,
    promptRef: args['prompt-file'],
    produces,
    metadata: {
      projectRoot,
      devTeamRoot,
      taskId: args['task-id'],
      stepId: args['step-id'],
    },
  }

  if (args.wait) {
    const job = await submitAndWait(input)
    console.log(JSON.stringify(job, null, 2))
    process.exit(job.status === 'succeeded' ? 0 : 1)
  }

  const job = submitJob(input)
  console.log(JSON.stringify(job, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
