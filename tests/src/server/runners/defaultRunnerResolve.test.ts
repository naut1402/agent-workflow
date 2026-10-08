import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  deleteConnection,
  getDefaultRunner,
  listRunners,
  resetDefaultRunnerWarn,
  resolveDefaultRunner,
  setDefaultRunner,
  upsertConnection,
  upsertRunner,
} from '../../../../src/features/runner/business/index.js'
import type { RunnerConfig, RunnersStore } from '../../../../src/features/runner/business/types.js'

// T6fabee9b · nhóm A của test-spec — `resolveDefaultRunner()` / `getDefaultRunner()`.
//
// Bug gốc: thêm một runner mới làm step KHÔNG pin runner chạy bằng runner vừa
// thêm. Nguyên nhân là `getDefaultRunner()` có vế thứ hai `find(isEligible)` —
// default đã ghi nhận mà hỏng thì nó lặng lẽ rơi sang "runner hợp lệ đầu tiên",
// tức một runner người dùng chưa bao giờ chọn. Fix bỏ hẳn vế đó: thà đứng lại
// với một `reason` đọc được còn hơn chạy sai runner.
//
// Vì vậy ca trung tâm ở đây là TC-D02 và TC-D22 — cả hai assert **vế phủ định**
// (🚫 không rơi sang runner kia), chứ không chỉ assert giá trị trả về.
//
// Khuôn theo `stepRunnerResolve.test.ts`: home tạm qua `DEV_TEAM_DASHBOARD_HOME`,
// xoá store ở `beforeEach`, bắt `console.warn` vào `warnings`.

let home: string
const savedEnv = { ...process.env }
const warnings: string[] = []
const realWarn = console.warn

/** Provider họ `ai-api` — `providerFamilyOf` xét hậu tố `-api`, không xét gì khác. */
const AI_PROVIDER = 'stub-default-resolve-api'
/** Hậu tố lạ ⇒ rơi về họ `console-command` ⇒ 🚫 không đủ điều kiện làm default. */
const SHELL_PROVIDER = 'stub-default-resolve-shell'

/** Runner dùng được: connection trỏ provider họ `ai-api`. */
function seedAiRunner(id: string, opts: { enabled?: boolean } = {}) {
  upsertConnection({ id: `conn-${id}`, kind: 'local-console', providerId: AI_PROVIDER, cliPath: 'stub' })
  upsertRunner({ id, connectionId: `conn-${id}`, enabled: opts.enabled !== false, config: {} })
}

/**
 * Runner KHÔNG chạy agent được, nhưng `setDefaultRunner()` vẫn nhận: guard ở đó
 * chỉ chặn đúng chuỗi `console-command`, nên một provider lạ đi lọt — đúng cái
 * cách store thật rơi vào trạng thái "default đã ghi nhận mà không đủ điều kiện".
 */
function seedShellRunner(id: string) {
  upsertConnection({ id: `conn-${id}`, kind: 'local-console', providerId: SHELL_PROVIDER, cliPath: 'stub' })
  upsertRunner({ id, connectionId: `conn-${id}`, config: {} })
}

/** Store dựng tay — cần cho các nhánh mà `loadRunners()` tự sửa trước khi tới nơi. */
function storeOf(defaultRunnerId: string | null, runners: Array<Partial<RunnerConfig>>): RunnersStore {
  return {
    version: 2,
    defaultRunnerId,
    runners: runners.map((r) => ({
      id: 'r',
      name: 'R',
      connectionId: 'c',
      enabled: true,
      maxConcurrency: 1,
      config: {},
      ...r,
    })) as RunnerConfig[],
  }
}

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dtd-default-runner-'))
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
  // `lastDefaultWarn` là state module-level sống xuyên test — đưa về trạng thái
  // biết trước thay vì dựa vào thứ tự chạy.
  resetDefaultRunnerWarn()
  warnings.length = 0
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
})
afterEach(() => {
  console.warn = realWarn
})

describe('resolveDefaultRunner — default dùng được', () => {
  test('TC-D01: default trỏ đúng một runner AI đang bật ⇒ ok', () => {
    seedAiRunner('claude')
    setDefaultRunner('claude')

    const res = resolveDefaultRunner()
    expect(res.reason).toBe('ok')
    expect(res.runnerId).toBe('claude')
    expect(res.runner?.id).toBe('claude')
    expect(getDefaultRunner()?.id).toBe('claude')
    expect(warnings).toEqual([])
  })
})

describe('resolveDefaultRunner — default hỏng ⇒ đứng lại, KHÔNG rơi sang runner khác', () => {
  test('TC-D02: default đang TẮT trong khi store còn runner AI khác dùng được ⇒ null + disabled', () => {
    seedAiRunner('con-song') // runner AI khác, hoàn toàn dùng được
    seedAiRunner('da-tat', { enabled: false })
    setDefaultRunner('da-tat')

    const res = resolveDefaultRunner()
    expect(res.reason).toBe('disabled')
    expect(res.runnerId).toBe('da-tat')
    expect(res.runner).toBe(null)

    // Vế phủ định — đây là chính cái bug: 🚫 TUYỆT ĐỐI không trả `con-song`.
    const picked = getDefaultRunner()
    expect(picked).toBe(null)
    expect(picked?.id).not.toBe('con-song')
  })

  test('TC-D03: default dùng connection provider console-command ⇒ not-ai', () => {
    seedAiRunner('claude')
    setDefaultRunner('claude')
    // Người dùng sửa chính connection đó sang console-command sau khi đã chốt
    // default — `setDefaultRunner` chặn đường trực tiếp, đường này thì không.
    upsertConnection({
      id: 'conn-claude',
      kind: 'local-console',
      providerId: 'console-command',
      cliPath: 'stub',
    })

    const res = resolveDefaultRunner()
    expect(res.reason).toBe('not-ai')
    expect(res.runnerId).toBe('claude')
    expect(res.runner).toBe(null)
    expect(getDefaultRunner()).toBe(null)
  })

  test('TC-D04: connection của runner default đã bị xoá ⇒ no-connection', () => {
    seedAiRunner('claude')
    setDefaultRunner('claude')
    expect(deleteConnection('conn-claude')).toEqual({ ok: true })

    const res = resolveDefaultRunner()
    expect(res.reason).toBe('no-connection')
    expect(res.runnerId).toBe('claude')
    expect(res.runner).toBe(null)
    expect(getDefaultRunner()).toBe(null)
  })

  test('TC-D05: store không có runner nào ⇒ no-runners, runnerId null', () => {
    const res = resolveDefaultRunner()
    expect(res).toEqual({ runner: null, runnerId: null, reason: 'no-runners' })
    expect(getDefaultRunner()).toBe(null)
  })

  test('TC-D22: runner đủ điều kiện đứng TRƯỚC default hỏng trong mảng ⇒ vẫn null', () => {
    // Thứ tự mảng là đúng thứ tự mà vế `find(isEligible)` cũ sẽ quét: runner
    // dùng được nằm ở index 0. Nếu vế đó còn sót lại ở bất kỳ dạng nào, ca này
    // trả `dung-duoc` thay vì null.
    seedAiRunner('dung-duoc')
    seedShellRunner('khong-chay-agent-duoc')
    setDefaultRunner('khong-chay-agent-duoc')

    const store = resolveDefaultRunner()
    expect(store.reason).toBe('not-ai')
    expect(store.runnerId).toBe('khong-chay-agent-duoc')

    const picked = getDefaultRunner()
    expect(picked).toBe(null)
    expect(picked?.id).not.toBe('dung-duoc')
  })
})

describe('resolveDefaultRunner — nhánh chỉ tới được khi truyền store tường minh', () => {
  // `loadRunners()` tự suy `defaultRunnerId = runners[0].id` khi id đã ghi nhận
  // không còn trong mảng (nợ ghi ở design §6), nên hai nhánh dưới không đi qua
  // đường đọc file được. Truyền store tay là cách duy nhất chấm chúng.
  test('TC-D20: defaultRunnerId trỏ id không tồn tại ⇒ missing', () => {
    const res = resolveDefaultRunner(storeOf('da-bay-mau', [{ id: 'con-lai' }]))
    expect(res.reason).toBe('missing')
    expect(res.runnerId).toBe('da-bay-mau')
    expect(res.runner).toBe(null)
  })

  test('TC-D21: có runner nhưng defaultRunnerId === null ⇒ unset', () => {
    const res = resolveDefaultRunner(storeOf(null, [{ id: 'con-lai' }]))
    expect(res).toEqual({ runner: null, runnerId: null, reason: 'unset' })
  })
})

describe('getDefaultRunner — throttle cảnh báo (E6)', () => {
  test('TC-D06: default hỏng, gọi 3 lần liên tiếp ⇒ đúng 1 dòng warn', () => {
    seedAiRunner('da-tat', { enabled: false })
    setDefaultRunner('da-tat')

    for (let i = 0; i < 3; i++) expect(getDefaultRunner()).toBe(null)

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('da-tat')
    expect(warnings[0]).toContain('disabled')
  })

  test('TC-D23: hỏng → sửa về ok → hỏng lại ⇒ lần hỏng thứ hai VẪN log (tổng 2)', () => {
    seedAiRunner('claude')
    seedAiRunner('du-phong')
    setDefaultRunner('claude')
    upsertRunner({ id: 'claude', connectionId: 'conn-claude', enabled: false, config: {} })

    expect(getDefaultRunner()).toBe(null)
    expect(warnings).toHaveLength(1)

    // Về `ok` — throttle phải xoá dấu ở đây, nếu không lần hỏng sau sẽ câm.
    upsertRunner({ id: 'claude', connectionId: 'conn-claude', enabled: true, config: {} })
    expect(getDefaultRunner()?.id).toBe('claude')
    expect(warnings).toHaveLength(1)

    upsertRunner({ id: 'claude', connectionId: 'conn-claude', enabled: false, config: {} })
    expect(getDefaultRunner()).toBe(null)
    expect(warnings).toHaveLength(2)
  })
})

describe('listRunners — hai trường dẫn xuất cho UI (bịt G2)', () => {
  test('TC-D07: default hỏng ⇒ giữ defaultRunnerId, effective = null, kèm issue', () => {
    seedAiRunner('da-tat', { enabled: false })
    setDefaultRunner('da-tat')

    const listed = listRunners()
    // Id đã ghi nhận phải còn — UI cần biết runner NÀO đang hỏng để sửa.
    expect(listed.defaultRunnerId).toBe('da-tat')
    expect(listed.effectiveDefaultRunnerId).toBe(null)
    expect(listed.defaultRunnerIssue).toEqual({ runnerId: 'da-tat', reason: 'disabled' })
  })
})
