import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  resolveStepRunnerId,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'

// Tbfb52394 · nhóm A của test-spec — quy tắc giải `steps[].runner_id` của một step.
//
// Đây là hàm dùng chung cho MỌI đường start job, nên nó là chỗ duy nhất đáng
// assert quy tắc: pin hỏng (runner đã xoá / disable / không chạy AI được) luôn
// rơi về "không chỉ định" để `submitJob` dùng runner mặc định — dọn danh sách
// runner không được làm đứng pipeline đang chạy — và `reason` là thứ duy nhất
// phân biệt "không pin" với "pin hỏng".
//
// Hai ca nguy hiểm nhất là TC-A07 / TC-A12: `sanitiseRunnerId` *gọt* ký tự lạ và
// *cắt* ở 64 ký tự thay vì từ chối, nên `getRunner(raw)` một mình sẽ khớp nhầm
// một pin rác sang một runner có thật (`types.ts` sanitiseRunnerId).

let home: string
const savedEnv = { ...process.env }
const warnings: string[] = []
const realWarn = console.warn

/** Runner dùng được để chạy agent: connection trỏ provider họ `ai-api`. */
function seedAiRunner(id: string, opts: { enabled?: boolean } = {}) {
  upsertConnection({
    id: `conn-${id}`,
    kind: 'local-console',
    providerId: 'stub-step-runner-api',
    cliPath: 'stub',
  })
  upsertRunner({ id, connectionId: `conn-${id}`, enabled: opts.enabled !== false, config: {} })
}

/** Runner họ `agent-cli` — `claude-code-cli` nằm trong AGENT_CLI_PROVIDER_IDS. */
function seedAgentCliRunner(id: string) {
  upsertConnection({
    id: `conn-${id}`,
    kind: 'local-console',
    providerId: 'claude-code-cli',
    cliPath: 'stub',
  })
  upsertRunner({ id, connectionId: `conn-${id}`, config: {} })
}

/** Runner console-command — chạy lệnh shell, không chạy được agent. */
function seedConsoleRunner(id: string) {
  upsertConnection({
    id: `conn-${id}`,
    kind: 'local-console',
    providerId: 'console-command',
    cliPath: 'stub',
  })
  upsertRunner({ id, connectionId: `conn-${id}`, config: {} })
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-step-runner-'))
  process.env.DEV_TEAM_DASHBOARD_HOME = home
})
afterAll(() => {
  process.env = savedEnv
  console.warn = realWarn
  fs.rmSync(home, { recursive: true, force: true })
})
beforeEach(() => {
  for (const f of ['runners.json', 'connections.json']) {
    fs.rmSync(path.join(home, f), { force: true })
  }
  warnings.length = 0
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
})
afterEach(() => {
  console.warn = realWarn
})

describe('resolveStepRunnerId — step không pin', () => {
  test('TC-A01: step không có key runner_id ⇒ unpinned, không cảnh báo', () => {
    seedAiRunner('gemini-api-runner')
    expect(resolveStepRunnerId({ id: 'reviewer', agent: 'p:reviewer' })).toEqual({
      runnerId: undefined,
      reason: 'unpinned',
    })
    expect(warnings).toEqual([])
  })

  test('TC-A09: chuỗi rỗng / toàn khoảng trắng là "không pin", KHÔNG phải "pin hỏng"', () => {
    seedAiRunner('gemini-api-runner')
    for (const raw of ['', '   ', '\t\n']) {
      expect(resolveStepRunnerId({ id: 'reviewer', runner_id: raw })).toEqual({
        runnerId: undefined,
        reason: 'unpinned',
      })
    }
    // Gỡ pin trên UI ghi '' xuống YAML per-task (TC-H03) — cảnh báo ở đây là
    // log rác cho mọi step chưa pin của mọi lần chạy.
    expect(warnings).toEqual([])
  })

  test('TC-A10: runner_id không phải string ⇒ unpinned, không cảnh báo, không throw', () => {
    seedAiRunner('gemini-api-runner')
    for (const raw of [123, null, {}, [], true]) {
      expect(resolveStepRunnerId({ id: 'reviewer', runner_id: raw })).toEqual({
        runnerId: undefined,
        reason: 'unpinned',
      })
    }
    expect(warnings).toEqual([])
  })

  test('TC-A11: chính step là null / undefined / {} ⇒ unpinned, không throw', () => {
    seedAiRunner('gemini-api-runner')
    for (const step of [null, undefined, {}]) {
      expect(resolveStepRunnerId(step)).toEqual({ runnerId: undefined, reason: 'unpinned' })
    }
    expect(warnings).toEqual([])
  })
})

describe('resolveStepRunnerId — pin dùng được', () => {
  test('TC-A02: runner ai-api đang bật ⇒ pinned, trả đúng id, không cảnh báo', () => {
    seedAiRunner('gemini-api-runner')
    expect(resolveStepRunnerId({ id: 'reviewer', runner_id: 'gemini-api-runner' })).toEqual({
      runnerId: 'gemini-api-runner',
      reason: 'pinned',
    })
    expect(warnings).toEqual([])
  })

  test('TC-A03: runner họ agent-cli cũng hợp lệ — không chỉ ai-api mới chạy agent được', () => {
    seedAgentCliRunner('claude-local')
    expect(resolveStepRunnerId({ id: 'reviewer', runner_id: 'claude-local' })).toEqual({
      runnerId: 'claude-local',
      reason: 'pinned',
    })
    expect(warnings).toEqual([])
  })
})

describe('resolveStepRunnerId — pin hỏng ⇒ rơi về mặc định + đúng 1 cảnh báo', () => {
  test('TC-A04: runner đã bị xoá khỏi registry ⇒ missing', () => {
    seedAiRunner('gemini-api-runner')
    expect(resolveStepRunnerId({ id: 'reviewer', runner_id: 'da-xoa' })).toEqual({
      runnerId: undefined,
      reason: 'missing',
    })
    // Một dòng, và phải đủ manh mối để truy: step nào pin cái gì.
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('reviewer')
    expect(warnings[0]).toContain('da-xoa')
  })

  test('TC-A05: runner tồn tại nhưng enabled: false ⇒ disabled (trước đây job fail cứng)', () => {
    seedAiRunner('gemini-api-runner')
    seedAiRunner('tat-roi', { enabled: false })
    expect(resolveStepRunnerId({ id: 'reviewer', runner_id: 'tat-roi' })).toEqual({
      runnerId: undefined,
      reason: 'disabled',
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('tat-roi')
  })

  test('TC-A06: runner họ console-command ⇒ ineligible (chạy shell, không chạy agent)', () => {
    seedAiRunner('gemini-api-runner')
    seedConsoleRunner('chay-lenh')
    expect(resolveStepRunnerId({ id: 'reviewer', runner_id: 'chay-lenh' })).toEqual({
      runnerId: undefined,
      reason: 'ineligible',
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('chay-lenh')
  })
})

describe('resolveStepRunnerId — pin rác không được khớp nhầm runner khác', () => {
  test('TC-A07: "gem.ini" KHÔNG khớp runner "gemini" — sanitise gọt dấu chấm', () => {
    seedAiRunner('gemini')
    // `getRunner('gem.ini')` một mình sẽ trả runner `gemini`: sanitiseRunnerId
    // xoá ký tự ngoài [a-zA-Z0-9_-] thay vì từ chối. So sánh bằng chặn trước.
    expect(resolveStepRunnerId({ id: 'reviewer', runner_id: 'gem.ini' })).toEqual({
      runnerId: undefined,
      reason: 'missing',
    })
    expect(warnings).toHaveLength(1)
  })

  test('TC-A08: "gem/ini" ⇒ missing — lớp sanitise đã chặn sẵn dấu /', () => {
    seedAiRunner('gemini')
    expect(resolveStepRunnerId({ id: 'reviewer', runner_id: 'gem/ini' })).toEqual({
      runnerId: undefined,
      reason: 'missing',
    })
    expect(resolveStepRunnerId({ id: 'reviewer', runner_id: 'gem\\ini' })).toMatchObject({
      reason: 'missing',
    })
  })

  test('TC-A12: id 100 ký tự hợp lệ ⇒ missing, không khớp sang runner nào (sanitise cắt ở 64)', () => {
    const long = 'a'.repeat(100)
    // Runner có đúng id = 64 ký tự đầu: nếu so sánh bằng bản đã cắt thì pin rác
    // này sẽ khớp vào nó.
    seedAiRunner(long.slice(0, 64))
    expect(resolveStepRunnerId({ id: 'reviewer', runner_id: long })).toEqual({
      runnerId: undefined,
      reason: 'missing',
    })
    expect(warnings).toHaveLength(1)
  })
})
