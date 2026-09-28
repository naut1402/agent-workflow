import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_PIPELINE, knownArtifactsFor, loadPipelineConfig } from '../../../../src/features/pipeline-editor/business/pipeline/index'

let dirs: string[] = []
async function tmpRoot(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })))
  dirs = []
})

describe('loadPipelineConfig layering', () => {
  test('returns builtin default when no pipeline.yaml exists', async () => {
    const cfg = await loadPipelineConfig(await tmpRoot(), null)
    expect(cfg.source).toBe('builtin')
    expect(cfg.steps.map((s: any) => s.id)).toEqual(DEFAULT_PIPELINE.steps.map((s: any) => s.id))
  })

  test('global pipeline.yaml replaces steps and marks source=global', async () => {
    const root = await tmpRoot()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), 'steps:\n  - id: only\n    name: Only\n')
    const cfg = await loadPipelineConfig(root, null)
    expect(cfg.source).toBe('global')
    expect(cfg.steps.map((s: any) => s.id)).toEqual(['only'])
  })

  test('per-task patch by id layers over global (source=global+task)', async () => {
    const root = await tmpRoot()
    await fs.writeFile(path.join(root, 'pipeline.yaml'), 'steps:\n  - id: a\n    name: A\n  - id: b\n    name: B\n')
    await fs.mkdir(path.join(root, 'tasks', 'T1'), { recursive: true })
    await fs.writeFile(path.join(root, 'tasks', 'T1', 'pipeline.yaml'), 'steps:\n  - id: a\n    name: A2\n')
    const cfg = await loadPipelineConfig(root, 'T1')
    expect(cfg.source).toBe('global+task')
    expect(cfg.steps.find((s: any) => s.id === 'a').name).toBe('A2')
  })

  test('per-task full replace via disjoint ids (source=task-replace)', async () => {
    const root = await tmpRoot()
    await fs.mkdir(path.join(root, 'tasks', 'T2'), { recursive: true })
    await fs.writeFile(path.join(root, 'tasks', 'T2', 'pipeline.yaml'), 'steps:\n  - id: brand-new\n    name: New\n')
    const cfg = await loadPipelineConfig(root, 'T2')
    expect(cfg.source).toBe('task-replace')
    expect(cfg.steps.map((s: any) => s.id)).toEqual(['brand-new'])
  })
})

// TC-05 (D2): `DEFAULT_PIPELINE` là fallback built-in dùng khi project chưa có
// `pipeline.yaml` riêng — không còn được phép tham chiếu `phpstan.md` (đặc thù
// PHP), và mọi step phải mang `rule_category`/`rule_required` khớp asset
// canonical (`docs/template/pipeline/pipeline.default.yaml`).
describe('DEFAULT_PIPELINE (D2 — không còn phpstan.md)', () => {
  test('không step nào produces() tham chiếu phpstan.md', () => {
    for (const step of DEFAULT_PIPELINE.steps) {
      expect((step.produces ?? []).join(',')).not.toContain('phpstan')
    }
  })

  test('implementer.produces rỗng, reviewer.produces không còn phpstan.md', () => {
    const implementer = DEFAULT_PIPELINE.steps.find((s: any) => s.id === 'implementer')
    const reviewer = DEFAULT_PIPELINE.steps.find((s: any) => s.id === 'reviewer')
    expect(implementer.produces).toEqual([])
    expect(reviewer.produces).toEqual(['review.md', 'test-spec.md'])
  })

  test('cấu trúc bước giữ nguyên (investigator/designer/implementer/reviewer/pr-creator)', () => {
    expect(DEFAULT_PIPELINE.steps.map((s: any) => s.id)).toEqual([
      'investigator',
      'designer',
      'implementer',
      'reviewer',
      'pr-creator',
    ])
  })

  test('mọi step đều có rule_category + rule_required (khớp asset canonical)', () => {
    for (const step of DEFAULT_PIPELINE.steps) {
      expect(step.rule_category).toBeTruthy()
      expect(typeof step.rule_required).toBe('boolean')
    }
  })
})

// Chống lệch lại 3 bản copy (nguyên nhân gốc của issue #1/#2 theo investigate.md):
// `DEFAULT_PIPELINE` (code) và `docs/template/pipeline/pipeline.default.yaml`
// (asset "trung lập" trong chính repo này) phải khớp nhau trên đúng các field
// D2 đối chiếu ở design.md §4.2 (id/produces/rule_category/rule_required/
// rule_fallback_skill) — không so toàn bộ object 1:1 vì `knowledge_inputs` là
// field có sẵn từ trước, không thuộc phạm vi D2, và hiện đang khai không đều
// giữa các step ngay trong chính file docs/template (chỉ investigator có
// `knowledge_inputs: []`) — lệch có sẵn, ngoài phạm vi task này (không phải bug
// do D2 gây ra), nên không chấm field đó ở đây.
describe('docs/template/pipeline/pipeline.default.yaml đồng bộ với DEFAULT_PIPELINE', () => {
  const RELEVANT_FIELDS = ['id', 'produces', 'rule_category', 'rule_required', 'rule_fallback_skill'] as const

  function pick(step: any) {
    return Object.fromEntries(RELEVANT_FIELDS.map((f) => [f, step[f]]))
  }

  test('steps khớp trên id/produces/rule_category/rule_required/rule_fallback_skill', async () => {
    const { loadYaml } = await import('../../../../src/shared/lib/yamlLib')
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const raw = await fs.readFile(
      path.join(import.meta.dir, '../../../../docs/template/pipeline/pipeline.default.yaml'),
      'utf8',
    )
    const doc = loadYaml(raw) as any
    expect(doc.steps.map(pick)).toEqual(DEFAULT_PIPELINE.steps.map(pick))
  })

  test('doc_reviewer khớp y hệt (rule_required/rule_fallback_skill — điểm [must] đã fix ở commit 5ac5893)', async () => {
    const { loadYaml } = await import('../../../../src/shared/lib/yamlLib')
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const raw = await fs.readFile(
      path.join(import.meta.dir, '../../../../docs/template/pipeline/pipeline.default.yaml'),
      'utf8',
    )
    const doc = loadYaml(raw) as any
    expect(doc.doc_reviewer).toEqual(DEFAULT_PIPELINE.doc_reviewer)
  })
})

describe('knownArtifactsFor', () => {
  test('collects produces + qa.md + *-po.md sidecars', () => {
    const arts = knownArtifactsFor({ steps: [{ produces: ['design.md', 'phpstan.md'] }] })
    expect(arts).toContain('qa.md')
    expect(arts).toContain('design.md')
    expect(arts).toContain('design-po.md')
    expect(arts).toContain('phpstan-po.md')
  })
  test('always includes qa.md even with no steps', () => {
    expect(knownArtifactsFor({})).toEqual(['qa.md'])
  })
})
