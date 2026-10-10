import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_PIPELINE, loadPipelineConfig } from '../../../../../src/features/pipeline-editor/business/pipeline/index'

/**
 * T8e63498c — "there is no override" vs. "the override is broken".
 *
 * `loadPipelineConfig` always returns a full `steps` array, falling back to the
 * global then the builtin flow. That is fine for rendering, but gate
 * reconciliation asks the returned steps whether a pending gate still exists —
 * and a syntax error must not answer "no". `untrusted` is the flag that keeps
 * the two apart; without it a broken YAML silently releases a live HITL gate.
 */

async function tmp() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dtd-load-pipeline-'))
  return root
}

const GLOBAL_YAML = ['version: 1', 'steps:', '  - id: fetch', '  - id: designer', ''].join('\n')
// Unbalanced `{` — js-yaml throws rather than returning a partial document.
const BROKEN_YAML = [
  'version: 1',
  'steps:',
  '  - id: designer',
  '    hitl: { mode: manual, gate_id: g1',
  '',
].join('\n')

async function writeTaskPipeline(root: string, id: string, body: string) {
  await fs.mkdir(path.join(root, 'tasks', id), { recursive: true })
  await fs.writeFile(path.join(root, 'tasks', id, 'pipeline.yaml'), body, 'utf8')
}

describe('loadPipelineConfig — untrusted flag', () => {
  test('no per-task override at all is trusted: absence is real information', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), GLOBAL_YAML, 'utf8')

    const cfg = await loadPipelineConfig(root, 'T1')
    expect(cfg.untrusted).toBe(false)
    expect(cfg.source).toBe('global')
    expect(cfg.steps.map((s: any) => s.id)).toEqual(['fetch', 'designer'])
  })

  test('a per-task override that does not parse is flagged, not treated as absent', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), GLOBAL_YAML, 'utf8')
    await writeTaskPipeline(root, 'T2', BROKEN_YAML)

    const cfg = await loadPipelineConfig(root, 'T2')
    expect(cfg.untrusted).toBe(true)
    // The steps still fall back so the rest of the app keeps working — which is
    // exactly why callers need the flag to know they are looking at a stand-in.
    expect(cfg.steps.map((s: any) => s.id)).toEqual(['fetch', 'designer'])
  })

  test('a broken GLOBAL pipeline is flagged too — same fallback, same hazard', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), BROKEN_YAML, 'utf8')

    const cfg = await loadPipelineConfig(root, null)
    expect(cfg.untrusted).toBe(true)
    expect(cfg.source).toBe('builtin')
  })

  test('an empty override file is a well-formed "nothing here", not a failure', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), GLOBAL_YAML, 'utf8')
    await writeTaskPipeline(root, 'T3', '')

    // Flagging this would strand a task behind a gate over a harmless file.
    const cfg = await loadPipelineConfig(root, 'T3')
    expect(cfg.untrusted).toBe(false)
    expect(cfg.steps.map((s: any) => s.id)).toEqual(['fetch', 'designer'])
  })

  test('a valid override still merges as before and stays trusted', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), GLOBAL_YAML, 'utf8')
    await writeTaskPipeline(
      root,
      'T4',
      ['version: 1', 'steps_replace: true', 'steps:', '  - id: only-step', ''].join('\n'),
    )

    const cfg = await loadPipelineConfig(root, 'T4')
    expect(cfg.untrusted).toBe(false)
    expect(cfg.steps.map((s: any) => s.id)).toEqual(['only-step'])
  })
})

// ---------------------------------------------------------------------------
// Tbfb52394 · nhóm H của test-spec — `runner_id` (model pin) đi qua merge per-task.
//
// Merge chỉ nông một tầng (chỉ `hitl` merge sâu), nên `runner_id` phải là string
// PHẲNG: bọc nó thành object lồng thì một patch chỉ đặt model sẽ ghi đè nguyên
// khối và thổi bay field khác của step.
// ---------------------------------------------------------------------------

/** Pipeline global đầy đủ field: patch chỉ-runner_id không được làm mất cái nào. */
const FULL_GLOBAL = [
  'version: 1',
  'steps:',
  '  - id: implementer',
  '    name: Implement',
  '    agent: dev-agent-teams:implementer',
  '  - id: reviewer',
  '    name: Review',
  '    agent: dev-agent-teams:reviewer',
  '    skills: [coding-rules, write-tests]',
  '    rule_category: [coding, test]',
  '    rule_required: false',
  '    produces: [review.md, test-spec.md]',
  '    export_key: reviewer',
  '    hitl:',
  '      mode: manual',
  '      gate_id: hitl-3',
  '      blocking: true',
  '',
].join('\n')

async function stepsOf(root: string, taskId: string | null) {
  const cfg = await loadPipelineConfig(root, taskId)
  return cfg.steps as any[]
}

const byId = (steps: any[], id: string) => steps.find((s) => s.id === id)

describe('loadPipelineConfig — runner_id qua merge per-task', () => {
  test('TC-H01: patch CHỈ { id, runner_id } ⇒ giữ nguyên mọi field khác của step', async () => {
    const root = await tmp()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), FULL_GLOBAL, 'utf8')
    await writeTaskPipeline(
      root,
      'H1',
      ['version: 1', 'steps:', '  - id: reviewer', '    runner_id: gemini-api-runner', ''].join('\n'),
    )

    const reviewer = byId(await stepsOf(root, 'H1'), 'reviewer')
    expect(reviewer.runner_id).toBe('gemini-api-runner')
    // Patch nông: bọc runner_id thành object lồng sẽ làm cả khối này biến mất.
    expect(reviewer.name).toBe('Review')
    expect(reviewer.agent).toBe('dev-agent-teams:reviewer')
    expect(reviewer.skills).toEqual(['coding-rules', 'write-tests'])
    expect(reviewer.rule_category).toEqual(['coding', 'test'])
    expect(reviewer.produces).toEqual(['review.md', 'test-spec.md'])
    expect(reviewer.export_key).toBe('reviewer')
    expect(reviewer.hitl).toEqual({ mode: 'manual', gate_id: 'hitl-3', blocking: true })
    // Và không lây sang step khác (AC-5 ở tầng cấu hình).
    expect(byId(await stepsOf(root, 'H1'), 'implementer')).not.toHaveProperty('runner_id')
  })

  test('TC-H02: base đã pin "a", patch đặt "b" ⇒ patch của task thắng', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      ['version: 1', 'steps:', '  - id: reviewer', '    agent: x', '    runner_id: a', ''].join('\n'),
      'utf8',
    )
    await writeTaskPipeline(
      root,
      'H2',
      ['version: 1', 'steps:', '  - id: reviewer', '    runner_id: b', ''].join('\n'),
    )
    expect(byId(await stepsOf(root, 'H2'), 'reviewer').runner_id).toBe('b')
  })

  test('TC-H03: patch đặt runner_id rỗng ⇒ gỡ pin cho riêng task đó', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      ['version: 1', 'steps:', '  - id: reviewer', '    agent: x', '    runner_id: a', ''].join('\n'),
      'utf8',
    )
    await writeTaskPipeline(
      root,
      'H3',
      ['version: 1', 'steps:', '  - id: reviewer', "    runner_id: ''", ''].join('\n'),
    )
    // Chuỗi rỗng ⇒ `resolveStepRunnerId` coi là "không pin" (TC-A09), tức là
    // task này chạy bằng runner mặc định chứ không kế thừa pin của global.
    expect(byId(await stepsOf(root, 'H3'), 'reviewer').runner_id).toBe('')
  })

  test('TC-H04: steps_replace: true ⇒ thay thế toàn bộ, pin của global KHÔNG còn', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      ['version: 1', 'steps:', '  - id: reviewer', '    agent: x', '    runner_id: a', ''].join('\n'),
      'utf8',
    )
    await writeTaskPipeline(
      root,
      'H4',
      ['version: 1', 'steps_replace: true', 'steps:', '  - id: reviewer', '    agent: y', ''].join('\n'),
    )
    const reviewer = byId(await stepsOf(root, 'H4'), 'reviewer')
    expect(reviewer).not.toHaveProperty('runner_id')
    expect(reviewer.agent).toBe('y')
  })

  test('TC-H04b: steps_replace: true có khai runner_id ⇒ dùng đúng giá trị khai mới', async () => {
    const root = await tmp()
    await fs.writeFile(
      path.join(root, 'pipeline.yaml'),
      ['version: 1', 'steps:', '  - id: reviewer', '    agent: x', '    runner_id: a', ''].join('\n'),
      'utf8',
    )
    await writeTaskPipeline(
      root,
      'H4b',
      ['version: 1', 'steps_replace: true', 'steps:', '  - id: reviewer', '    runner_id: b', ''].join('\n'),
    )
    expect(byId(await stepsOf(root, 'H4b'), 'reviewer').runner_id).toBe('b')
  })

  test('TC-H05: pipeline mặc định dựng sẵn trong code KHÔNG pin step nào (AC-6)', async () => {
    const root = await tmp()
    const steps = await stepsOf(root, null)
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.some((s: any) => 'runner_id' in s)).toBe(false)
    expect(DEFAULT_PIPELINE.steps.some((s: any) => 'runner_id' in s)).toBe(false)
  })
})
