import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { collectTasks, flowProfilePath, listArtifacts, readState } from '../../../server/tasks/index'

let dirs: string[] = []
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'tasks-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })))
  dirs = []
})

describe('listArtifacts', () => {
  test('lists .md files, marks known-but-missing, finds subtasks, skips machine files', async () => {
    const dir = await tmp()
    await fs.writeFile(path.join(dir, 'design.md'), '# d')
    await fs.writeFile(path.join(dir, 'pipeline-export.json'), '{}')
    await fs.mkdir(path.join(dir, 'B4488-1'))
    const { artifacts, subtasks } = await listArtifacts(dir, ['design.md', 'review.md'])
    expect(artifacts['design.md'].exists).toBe(true)
    expect(artifacts['review.md']).toEqual({ exists: false, mtime: null, size: 0 })
    expect(artifacts['pipeline-export.json']).toBeUndefined()
    expect(subtasks).toEqual(['B4488-1'])
  })
  test('missing task dir → empty', async () => {
    expect(await listArtifacts(path.join(await tmp(), 'nope'), [])).toEqual({ artifacts: {}, subtasks: [] })
  })
})

describe('readState', () => {
  test('ok:true with parsed state', async () => {
    const dir = await tmp()
    const fp = path.join(dir, 's.json')
    await fs.writeFile(fp, '{"current_phase":"design"}')
    expect(await readState(fp)).toEqual({ ok: true, state: { current_phase: 'design' } })
  })
  test('ok:false with error on missing/invalid', async () => {
    const r = await readState(path.join(await tmp(), 'missing.json'))
    expect(r.ok).toBe(false)
  })
})

describe('flowProfilePath', () => {
  test('points under flow-profiles/<id>.json', () => {
    const root = path.resolve('/r')
    expect(flowProfilePath(root, 'F1')).toBe(path.join(root, 'flow-profiles', 'F1.json'))
  })
})

describe('collectTasks', () => {
  test('merges state-file ids and task-dir ids, sorted; defaults missing state', async () => {
    const root = await tmp()
    await fs.mkdir(path.join(root, '.dev-state'), { recursive: true })
    await fs.writeFile(path.join(root, '.dev-state', 'B1.json'), '{"current_phase":"design","review_round":2}')
    await fs.mkdir(path.join(root, 'tasks', 'B1'), { recursive: true })
    await fs.writeFile(path.join(root, 'tasks', 'B1', 'design.md'), '# d')
    // A task dir with no state file.
    await fs.mkdir(path.join(root, 'tasks', 'A0'), { recursive: true })
    await fs.writeFile(path.join(root, 'tasks', 'A0', 'qa.md'), '## Q1\n?\n## Q2\n?')

    const tasks = await collectTasks(root)
    expect(tasks.map((t) => t.task_id)).toEqual(['A0', 'B1'])

    const b1 = tasks.find((t) => t.task_id === 'B1')!
    expect(b1.state_ok).toBe(true)
    expect(b1.current_phase).toBe('design')
    expect(b1.review_round).toBe(2)
    expect(b1.artifacts['design.md'].exists).toBe(true)
    expect(b1.archived).toBe(false) // safe default when state has no archived field
    expect(b1.archived_at).toBeNull()

    const a0 = tasks.find((t) => t.task_id === 'A0')!
    expect(a0.state_ok).toBe(false)
    expect(a0.current_phase).toBeNull() // safe default
    expect(a0.has_qa).toBe(true)
    expect(a0.qa_count).toBe(2)
  })

  test('exposes archived + archived_at from state', async () => {
    const root = await tmp()
    await fs.mkdir(path.join(root, '.dev-state'), { recursive: true })
    await fs.writeFile(
      path.join(root, '.dev-state', 'B2.json'),
      '{"current_phase":"completed","archived":true,"archived_at":"2024-01-01T00:00:00.000Z"}',
    )

    const tasks = await collectTasks(root)
    const b2 = tasks.find((t) => t.task_id === 'B2')!
    expect(b2.archived).toBe(true)
    expect(b2.archived_at).toBe('2024-01-01T00:00:00.000Z')
  })

  test('empty root → []', async () => {
    expect(await collectTasks(await tmp())).toEqual([])
  })
})
