import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadPipelineConfig } from '../../../../../src/features/pipeline-editor/business/pipeline/index'

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
