import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_PIPELINE, knownArtifactsFor, loadPipelineConfig } from './index'

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
