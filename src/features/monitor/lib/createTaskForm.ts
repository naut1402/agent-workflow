import { TASK_ID_PATTERN } from '../../../core/contracts/schemas/taskCreate.js'
import type { TaskSource } from '../../../core/contracts/schemas/taskCreate.js'

export type TaskIdValidationCode = 'required' | 'invalid'

/** Validate a dashboard task id against the shared Zod charset. */
export function validateTaskId(raw: string): TaskIdValidationCode | null {
  const id = raw.trim()
  if (!id) return 'required'
  if (!TASK_ID_PATTERN.test(id)) return 'invalid'
  return null
}

export interface IssuePreviewInput {
  title: string
  body: string | null
  url: string
  prompt?: string
}

/** Prefer server-built prompt; fall back to a minimal brief for tests/offline. */
export function promptFromIssue(issue: IssuePreviewInput): string {
  if (issue.prompt?.trim()) return issue.prompt.trim()
  const parts = [`# ${issue.title}`, '', `Nguồn: ${issue.url}`]
  if (issue.body?.trim()) parts.push('', issue.body.trim())
  return parts.join('\n')
}

export interface CreateTaskPreviewInput {
  taskId: string
  source: TaskSource
  issueUrl?: string | null
  profileName?: string | null
  knowledgeInputs: string[]
  autoReview: boolean
  exportJson: boolean
  run: boolean
  runnerLabel?: string | null
  firstStepLabel?: string | null
}

export interface CreateTaskPreviewSummary {
  taskId: string
  source: TaskSource
  issueUrl: string | null
  profileName: string | null
  knowledgeCount: number
  knowledgeInputs: string[]
  autoReview: boolean
  exportJson: boolean
  run: boolean
  runnerLabel: string | null
  firstStepLabel: string | null
}

/** Pure snapshot for the preview step — no I/O. */
export function buildCreateTaskPreviewSummary(input: CreateTaskPreviewInput): CreateTaskPreviewSummary {
  return {
    taskId: input.taskId.trim(),
    source: input.source,
    issueUrl: input.issueUrl?.trim() || null,
    profileName: input.profileName?.trim() || null,
    knowledgeCount: input.knowledgeInputs.length,
    knowledgeInputs: [...input.knowledgeInputs],
    autoReview: input.autoReview,
    exportJson: input.exportJson,
    run: input.run,
    runnerLabel: input.runnerLabel ?? null,
    firstStepLabel: input.firstStepLabel ?? null,
  }
}

/** Whether step 1 can advance to pipeline selection. */
export function canAdvanceFromSourceStep(
  taskId: string,
  source: TaskSource,
  prompt: string,
  issueUrl: string,
  _issueLoaded = false,
): boolean {
  if (validateTaskId(taskId)) return false
  if (source === 'prompt') return prompt.trim().length > 0
  return issueUrl.trim().length > 0
}
