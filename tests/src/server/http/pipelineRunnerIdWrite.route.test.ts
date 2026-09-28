import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../../../../src/backend/apiServer.js'
import type { RegistryContext } from '../../../../src/backend/http/types.js'

// Tbfb52394 · nhóm E của test-spec — `steps[].runner_id` ở đường GHI pipeline.
//
// `runner_id` là khoá tra registry runner lúc execute, nên nó phải được kiểm
// giống `orchestrator.agent`: id bị `sanitiseRunnerId` *gọt* (vd `gem.ini` →
// `gemini`) phải bị TỪ CHỐI chứ không lưu âm thầm bản đã gọt — lưu bản gọt
// nghĩa là người dùng thấy một giá trị mà chạy ra một runner khác.
//
// Ngược lại, validate **không** kiểm runner có tồn tại trên máy này (TC-E06):
// profile pipeline được chia sẻ giữa các máy, chặn ở đây làm một profile hợp lệ
// trên máy A bị 400 trên máy B. Ca đó do `resolveStepRunnerId` lo lúc chạy.
// Hệ quả kèm theo: ràng buộc AC-3 ("> 1 runner") là ràng buộc UI, KHÔNG được rò
// xuống tầng validate backend.

let root: string
let app: Awaited<ReturnType<typeof createApp>>
const savedEnv = { ...process.env }

function fakeCtx(): RegistryContext {
  return {
    defaultRoot: root,
    resolveProjectRoot: (id: string | null) => (id ? null : root),
    registry: {
      list: () => ({ projects: [], defaultId: null }),
      get: () => null,
      add: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      remove: () => ({ ok: false, status: 400, error: 'stub' }) as any,
      validateProjectPath: (() => ({ ok: false, status: 400, error: 'stub' })) as any,
      seedDefault: () => null,
    },
  }
}

const BASELINE = ['version: 1', 'steps:', '  - id: reviewer', '    agent: dev:reviewer', ''].join('\n')

function globalYaml(): string {
  return fs.readFileSync(path.join(root, 'pipeline.yaml'), 'utf8')
}

/** Payload đủ hợp lệ, chỉ thay `runner_id` của step duy nhất. */
function pipelineWith(runnerId: unknown, omit = false) {
  const step: Record<string, unknown> = { id: 'reviewer', name: 'Review', agent: 'dev:reviewer' }
  if (!omit) step.runner_id = runnerId
  return { version: 1, steps: [step] }
}

function writeConfig(pipeline: unknown) {
  return app.request('/api/pipeline-config-write', {
    method: 'POST',
    body: JSON.stringify({ scope: 'global', pipeline }),
  })
}

function writeProfile(name: string, pipeline: unknown) {
  return app.request('/api/pipeline-profiles', {
    method: 'POST',
    body: JSON.stringify({ name, pipeline }),
  })
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-runner-pin-write-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = path.join(root, '.home')
  app = await createApp(fakeCtx())
})
afterAll(() => {
  process.env = savedEnv
  fs.rmSync(root, { recursive: true, force: true })
})
beforeEach(() => {
  fs.writeFileSync(path.join(root, 'pipeline.yaml'), BASELINE, 'utf8')
})

describe('POST /api/pipeline-config-write — runner_id hợp lệ', () => {
  test('TC-E01: runner_id đúng định dạng ⇒ 200 và YAML trên đĩa mang đúng giá trị', async () => {
    const res = await writeConfig(pipelineWith('gemini-api-runner'))
    expect(res.status).toBe(200)
    expect(globalYaml()).toContain('gemini-api-runner')
  })

  test('TC-E05: runner_id rỗng / null ⇒ 200 — "không pin" không phải giá trị sai', async () => {
    expect((await writeConfig(pipelineWith(''))).status).toBe(200)
    expect((await writeConfig(pipelineWith(null))).status).toBe(200)
  })

  test('TC-E06: runner không tồn tại trên máy này ⇒ vẫn 200 và ghi được', async () => {
    // Cố ý: profile pipeline đi giữa các máy. Ràng buộc "> 1 runner" là ràng
    // buộc của UI, không được rò xuống đây.
    const res = await writeConfig(pipelineWith('runner-khong-ton-tai-tren-may-nay'))
    expect(res.status).toBe(200)
    expect(globalYaml()).toContain('runner-khong-ton-tai-tren-may-nay')
  })

  test('TC-E08: payload cũ, không step nào khai runner_id ⇒ 200, hành vi nguyên trạng', async () => {
    const res = await writeConfig(pipelineWith(undefined, true))
    expect(res.status).toBe(200)
    expect(globalYaml()).not.toContain('runner_id')
  })
})

describe('POST /api/pipeline-config-write — runner_id sai ⇒ 400 và KHÔNG ghi', () => {
  test('TC-E02: id có dấu "/" (đường path-traversal) ⇒ 400, file không đổi', async () => {
    const before = globalYaml()
    const res = await writeConfig(pipelineWith('gem/ini'))
    expect(res.status).toBe(400)
    expect(globalYaml()).toBe(before)
  })

  test('TC-E03: id bị gọt ("gem.ini" → "gemini") ⇒ 400, KHÔNG âm thầm lưu bản đã gọt', async () => {
    const before = globalYaml()
    const res = await writeConfig(pipelineWith('gem.ini'))
    expect(res.status).toBe(400)
    expect(globalYaml()).toBe(before)
    // Không được lưu bản gọt: người dùng thấy `gem.ini`, hệ chạy `gemini`.
    expect(globalYaml()).not.toContain('gemini')
  })

  test('TC-E03b: id dài hơn 64 ký tự (bị cắt) ⇒ 400', async () => {
    expect((await writeConfig(pipelineWith('a'.repeat(100)))).status).toBe(400)
  })

  test('TC-E03c: khoảng trắng thừa quanh id ⇒ 400 (trim cũng là gọt)', async () => {
    expect((await writeConfig(pipelineWith(' gemini-api-runner '))).status).toBe(400)
  })

  test('TC-E04: runner_id là số / object / array / boolean ⇒ 400', async () => {
    for (const bad of [123, { id: 'x' }, ['x'], true]) {
      const before = globalYaml()
      const res = await writeConfig(pipelineWith(bad))
      expect(res.status).toBe(400)
      expect(globalYaml()).toBe(before)
    }
  })

  test('một step sai làm hỏng cả payload — không ghi một phần', async () => {
    const before = globalYaml()
    const res = await writeConfig({
      version: 1,
      steps: [
        { id: 'implementer', agent: 'a', runner_id: 'gemini-api-runner' },
        { id: 'reviewer', agent: 'b', runner_id: 'gem/ini' },
      ],
    })
    expect(res.status).toBe(400)
    expect(globalYaml()).toBe(before)
  })
})

describe('TC-E07: POST /api/pipeline-profiles chạy CÙNG validate', () => {
  test('runner_id hợp lệ ⇒ 200 và profile trên đĩa mang giá trị đó', async () => {
    const res = await writeProfile('pin-hop-le', pipelineWith('gemini-api-runner'))
    expect(res.status).toBe(200)
    const body = fs.readFileSync(path.join(root, 'pipeline-profiles', 'pin-hop-le.yaml'), 'utf8')
    expect(body).toContain('gemini-api-runner')
  })

  test.each([['gem/ini'], ['gem.ini'], [123]])(
    'runner_id sai (%p) ⇒ 400 — chặn một đường mà bỏ đường kia là không chặn gì',
    async (bad) => {
      const res = await writeProfile('pin-hong', pipelineWith(bad))
      expect(res.status).toBe(400)
      expect(fs.existsSync(path.join(root, 'pipeline-profiles', 'pin-hong.yaml'))).toBe(false)
    },
  )
})
