import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import yaml from 'js-yaml'
import { readYamlSafe } from '../../shared/fs.js'
import { sanitiseProfileName } from '../../shared/sanitize.js'
import { TASK_ID_PATTERN } from '../../shared/schemas/taskCreate.js'
import type { CreateTaskRequest } from '../../shared/schemas/taskCreate.js'
import { profilesDir } from '../agents/paths.js'
import { loadPipelineConfig } from '../pipeline/index.js'
import { writeStateAtomic } from './state.js'

export interface CreateTaskInput
  extends Omit<CreateTaskRequest, 'run' | 'runnerId' | 'taskId'> {
  taskId: string
}

export interface CreatedTask {
  taskId: string
  taskDir: string
  stateFile: string
  requestFile: string
  /** null when no per-task pipeline override was written. */
  pipelineFile: string | null
  state: Record<string, unknown>
  pipeline: any
  /** First step of the merged pipeline — what `current_phase` points at. */
  firstStep: Record<string, any> | null
  /** Rendered `request.md` (frontmatter + prompt), reused as the runner prompt. */
  requestContent: string
}

export type CreateTaskResult =
  | ({ ok: true } & CreatedTask)
  | { ok: false; status: number; error: string }

/** Atomic write: unique temp file in the target dir + rename. */
async function writeFileAtomic(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await fs.writeFile(tmp, content, 'utf8')
    await fs.rename(tmp, target)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/** `request.md` = YAML frontmatter (provenance) + the raw prompt body. */
export function renderRequestMarkdown(input: {
  taskId: string
  source: string
  issueUrl?: string | null
  knowledgeInputs: string[]
  createdAt: string
  prompt: string
}): string {
  const front = yaml.dump(
    {
      task_id: input.taskId,
      source: input.source,
      issue_url: input.issueUrl ?? null,
      knowledge_inputs: input.knowledgeInputs,
      created_at: input.createdAt,
      created_by: 'dashboard',
    },
    { lineWidth: 120 },
  )
  const body = input.prompt.replace(/\s+$/, '')
  return `---\n${front}---\n\n${body}\n`
}

/** Resolve the per-task pipeline override to write, or null when there is none. */
async function resolvePipelineOverride(
  root: string,
  input: CreateTaskInput,
): Promise<{ doc: Record<string, any>; replace: boolean } | null> {
  if (input.pipeline) return { doc: { ...input.pipeline }, replace: true }
  if (!input.profileName) return null
  const name = sanitiseProfileName(input.profileName)
  if (!name) return null
  const profile = await readYamlSafe(path.join(profilesDir(root), `${name}.yaml`))
  if (!profile || !Array.isArray(profile.steps) || profile.steps.length === 0) return null
  return { doc: { ...profile }, replace: true }
}

/**
 * Scaffold a new task under `<root>`: `tasks/<id>/request.md`, an optional
 * `tasks/<id>/pipeline.yaml`, and the orchestrator state at
 * `.dev-state/<id>.json` with `current_phase` = first step of the merged config.
 *
 * Never overwrites an existing task (409) — the orchestrator owns whatever is
 * already on disk.
 */
export async function createTask(root: string, input: CreateTaskInput): Promise<CreateTaskResult> {
  if (!TASK_ID_PATTERN.test(input.taskId)) {
    return { ok: false, status: 400, error: 'invalid task id' }
  }
  if (input.parentTaskId && !TASK_ID_PATTERN.test(input.parentTaskId)) {
    return { ok: false, status: 400, error: 'invalid parent task id' }
  }

  const taskId = input.taskId
  const taskDir = path.join(root, 'tasks', taskId)
  const stateFile = path.join(root, '.dev-state', `${taskId}.json`)

  try {
    await fs.access(stateFile)
    return { ok: false, status: 409, error: 'task already exists' }
  } catch {
    /* no state file — free to create */
  }

  // mkdir without `recursive` is the atomic half of the exists check: two
  // concurrent creates race here and the loser gets EEXIST → 409.
  await fs.mkdir(path.dirname(taskDir), { recursive: true })
  try {
    await fs.mkdir(taskDir)
  } catch (err: any) {
    if (err?.code === 'EEXIST') return { ok: false, status: 409, error: 'task already exists' }
    return { ok: false, status: 500, error: String(err?.message ?? err) }
  }

  const knowledgeInputs = input.knowledgeInputs ?? []
  const createdAt = new Date().toISOString()
  const requestFile = path.join(taskDir, 'request.md')
  const requestContent = renderRequestMarkdown({
    taskId,
    source: input.source,
    issueUrl: input.issueUrl,
    knowledgeInputs,
    createdAt,
    prompt: input.prompt,
  })

  let pipelineFile: string | null = null
  try {
    await writeFileAtomic(requestFile, requestContent)

    const override = await resolvePipelineOverride(root, input)
    if (override) {
      const steps = (override.doc.steps as Record<string, any>[]).map((s) => ({ ...s }))
      if (knowledgeInputs.length && steps[0]) {
        steps[0].knowledge_inputs = [...new Set([...(steps[0].knowledge_inputs ?? []), ...knowledgeInputs])]
      }
      pipelineFile = path.join(taskDir, 'pipeline.yaml')
      await writeFileAtomic(
        pipelineFile,
        yaml.dump({ ...override.doc, steps, steps_replace: override.replace }, { lineWidth: 120 }),
      )
    } else if (knowledgeInputs.length) {
      // No profile chosen: keep the inherited flow and only patch knowledge onto
      // its first step (patch-by-id, so `steps_replace` must stay off).
      const inherited = await loadPipelineConfig(root, null)
      const firstId = inherited.steps?.[0]?.id
      if (firstId) {
        pipelineFile = path.join(taskDir, 'pipeline.yaml')
        await writeFileAtomic(
          pipelineFile,
          yaml.dump({ steps: [{ id: firstId, knowledge_inputs: knowledgeInputs }] }, { lineWidth: 120 }),
        )
      }
    }

    const pipeline = await loadPipelineConfig(root, taskId)
    const firstStep = pipeline.steps?.[0] ?? null
    const state: Record<string, unknown> = {
      task_id: taskId,
      parent_task_id: input.parentTaskId ?? null,
      current_phase: firstStep?.id ?? null,
      hitl_pending: null,
      review_round: 0,
      auto_review: input.autoReview ?? pipeline.defaults?.auto_review ?? false,
      export_json: input.exportJson ?? pipeline.defaults?.export_json ?? false,
      doc_review_round: { investigate: 0, design: 0 },
      inherit_from_parent: [],
    }
    await writeStateAtomic(stateFile, state)

    return {
      ok: true,
      taskId,
      taskDir,
      stateFile,
      requestFile,
      pipelineFile,
      state,
      pipeline,
      firstStep,
      requestContent,
    }
  } catch (err: any) {
    // Roll back the scaffold so a failed create doesn't leave a half task that
    // would 409 on retry.
    await fs.rm(taskDir, { recursive: true, force: true }).catch(() => {})
    await fs.rm(stateFile, { force: true }).catch(() => {})
    return { ok: false, status: 500, error: String(err?.message ?? err) }
  }
}
