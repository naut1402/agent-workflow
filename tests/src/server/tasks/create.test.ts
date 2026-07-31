import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import { createTask, renderRequestMarkdown } from '../../../../src/features/monitor/business/tasks/create'
import { DEFAULT_PIPELINE } from '../../../../src/features/pipeline-editor/business/pipeline/index'

let dirs: string[] = []
async function tmpRoot(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'task-create-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })))
  dirs = []
})

describe('renderRequestMarkdown', () => {
  test('writes YAML frontmatter plus prompt body', () => {
    const md = renderRequestMarkdown({
      taskId: 'F0010',
      source: 'prompt',
      knowledgeInputs: ['project/foo'],
      createdAt: '2026-01-01T00:00:00.000Z',
      prompt: 'Do the thing',
    })
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('task_id: F0010')
    expect(md).toContain('created_by: dashboard')
    expect(md.endsWith('Do the thing\n')).toBe(true)
  })
})

describe('createTask', () => {
  test('scaffolds request.md, state, and sets current_phase to first step', async () => {
    const root = await tmpRoot()
    const result = await createTask(root, {
      taskId: 'F0010',
      source: 'prompt',
      prompt: 'Investigate login bug',
      knowledgeInputs: [],
      autoReview: false,
      exportJson: false,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const request = await fs.readFile(result.requestFile, 'utf8')
    expect(request).toContain('Investigate login bug')
    expect(request).toContain('created_by: dashboard')

    const state = JSON.parse(await fs.readFile(result.stateFile, 'utf8'))
    expect(state.task_id).toBe('F0010')
    expect(state.current_phase).toBe(DEFAULT_PIPELINE.steps[0].id)
    expect(state.review_round).toBe(0)
    expect(state.doc_review_round).toEqual({ investigate: 0, design: 0 })
    expect(result.pipelineFile).toBeNull()
  })

  test('writes pipeline.yaml from profile with knowledge on first step', async () => {
    const root = await tmpRoot()
    await fs.mkdir(path.join(root, 'pipeline-profiles'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'pipeline-profiles', 'quick.yaml'),
      yaml.dump({
        steps: [
          { id: 'investigator', agent: 'dev-agent-teams:investigator', produces: ['investigate.md'] },
          { id: 'designer', agent: 'dev-agent-teams:designer', produces: ['design.md'] },
        ],
      }),
      'utf8',
    )

    const result = await createTask(root, {
      taskId: 'F0011',
      source: 'prompt',
      prompt: 'Brief',
      profileName: 'quick',
      knowledgeInputs: ['project/context'],
      autoReview: true,
      exportJson: false,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const pipelineYaml = yaml.load(await fs.readFile(result.pipelineFile!, 'utf8')) as any
    expect(pipelineYaml.steps_replace).toBe(true)
    expect(pipelineYaml.steps[0].knowledge_inputs).toEqual(['project/context'])
    expect(result.state.auto_review).toBe(true)
    expect(result.firstStep?.id).toBe('investigator')
  })

  test('409 when state file already exists', async () => {
    const root = await tmpRoot()
    await fs.mkdir(path.join(root, '.dev-state'), { recursive: true })
    await fs.writeFile(path.join(root, '.dev-state', 'T1.json'), '{}', 'utf8')

    const result = await createTask(root, {
      taskId: 'T1',
      source: 'prompt',
      prompt: 'x',
      knowledgeInputs: [],
      autoReview: false,
      exportJson: false,
    })
    expect(result.ok).toBe(false)
    if (!('error' in result)) return
    expect(result.status).toBe(409)
  })

  test('409 when task directory already exists', async () => {
    const root = await tmpRoot()
    await fs.mkdir(path.join(root, 'tasks', 'T2'), { recursive: true })

    const result = await createTask(root, {
      taskId: 'T2',
      source: 'prompt',
      prompt: 'x',
      knowledgeInputs: [],
      autoReview: false,
      exportJson: false,
    })
    expect(result.ok).toBe(false)
    if (!('error' in result)) return
    expect(result.status).toBe(409)
  })

  test('rejects invalid task ids (traversal / charset)', async () => {
    const root = await tmpRoot()
    for (const taskId of ['../evil', '-bad', 'a/b', '']) {
      const result = await createTask(root, {
        taskId,
        source: 'prompt',
        prompt: 'x',
        knowledgeInputs: [],
        autoReview: false,
        exportJson: false,
      })
      expect(result.ok).toBe(false)
      if (!('error' in result)) return
      expect(result.status).toBe(400)
    }
  })
})
