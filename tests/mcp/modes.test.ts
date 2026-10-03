// Tb4241005 · TC-31 … TC-48 — mode vận hành của MCP server (vai inbound).
//
// `resolveMode` nhận `argv` / `env` / `warn` qua tham số nên phần lớn case
// truyền thẳng, không mock global. Nhánh MẶC ĐỊNH vẫn đọc `process.env`, nên
// suite vẫn phải cô lập `DEVTEAM_MCP_MODE` + `DEVTEAM_MCP_PROJECT` (§1.4 /
// TC-48): máy dev đặt `full` sẽ làm case "mặc định readonly" xanh/đỏ giả.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  DEFAULT_MODE,
  MCP_MODES,
  MODE_ENV_VAR,
  READ_TOOLS,
  TOOL_ALLOWLIST,
  WRITE_TOOLS,
  isMcpMode,
  isToolEnabled,
  parseModeArg,
  resolveMode,
} from '../../mcp/modes'

// ── Cô lập env (§1.4) ─────────────────────────────────────────────────────────

const ISOLATED = ['DEVTEAM_MCP_MODE', 'DEVTEAM_MCP_PROJECT'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ISOLATED) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})
afterEach(() => {
  for (const key of ISOLATED) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

/** Thu lời gọi `warn` để assert cả SỐ LẦN lẫn NỘI DUNG. */
function spyWarn() {
  const calls: string[] = []
  const warn = (msg: string) => void calls.push(msg)
  return { calls, warn }
}

describe('resolveMode — nguồn giá trị & thứ tự ưu tiên', () => {
  test('TC-31: không CLI, không env → readonly, không cảnh báo', () => {
    const { calls, warn } = spyWarn()
    expect(resolveMode({ argv: [], env: {}, warn })).toBe('readonly')
    expect(calls).toHaveLength(0)
  })

  test('TC-32: env full', () => {
    const { calls, warn } = spyWarn()
    expect(resolveMode({ argv: [], env: { DEVTEAM_MCP_MODE: 'full' }, warn })).toBe('full')
    expect(calls).toHaveLength(0)
  })

  test('TC-33: env readonly', () => {
    const { calls, warn } = spyWarn()
    expect(resolveMode({ argv: [], env: { DEVTEAM_MCP_MODE: 'readonly' }, warn })).toBe('readonly')
    expect(calls).toHaveLength(0)
  })

  test('TC-34: CLI --mode=full thắng env readonly', () => {
    const { calls, warn } = spyWarn()
    expect(
      resolveMode({ argv: ['--mode=full'], env: { DEVTEAM_MCP_MODE: 'readonly' }, warn }),
    ).toBe('full')
    expect(calls).toHaveLength(0)
  })

  test('TC-35: CLI --mode=readonly thắng env full (chiều chứng minh được)', () => {
    const { calls, warn } = spyWarn()
    expect(
      resolveMode({ argv: ['--mode=readonly'], env: { DEVTEAM_MCP_MODE: 'full' }, warn }),
    ).toBe('readonly')
    expect(calls).toHaveLength(0)
  })

  test('TC-36: CLI dạng hai token --mode full', () => {
    const { calls, warn } = spyWarn()
    expect(resolveMode({ argv: ['--mode', 'full'], env: {}, warn })).toBe('full')
    expect(calls).toHaveLength(0)
  })

  test('TC-36b: flag lẫn giữa các đối số khác vẫn đọc được', () => {
    expect(resolveMode({ argv: ['--verbose', '--mode', 'full', '--x'], env: {} })).toBe('full')
    expect(resolveMode({ argv: ['--verbose', '--mode=full'], env: {} })).toBe('full')
  })
})

describe('resolveMode — giá trị không hợp lệ', () => {
  test('TC-37: CLI rác KHÔNG rơi ngược về env (không nâng quyền ngầm)', () => {
    const { calls, warn } = spyWarn()
    expect(
      resolveMode({ argv: ['--mode=bogus'], env: { DEVTEAM_MCP_MODE: 'full' }, warn }),
    ).toBe('readonly')
    expect(calls).toHaveLength(1)
  })

  test('TC-38: env rác → readonly + đúng 1 cảnh báo', () => {
    const { calls, warn } = spyWarn()
    expect(resolveMode({ argv: [], env: { DEVTEAM_MCP_MODE: 'bogus' }, warn })).toBe('readonly')
    expect(calls).toHaveLength(1)
  })

  test('TC-39: env chuỗi rỗng là GIÁ TRỊ SAI, không phải "không đặt"', () => {
    const { calls, warn } = spyWarn()
    expect(resolveMode({ argv: [], env: { DEVTEAM_MCP_MODE: '' }, warn })).toBe('readonly')
    expect(calls).toHaveLength(1)
  })

  test('TC-39b: --mode thiếu giá trị cũng là "khai sai"', () => {
    const { calls, warn } = spyWarn()
    expect(resolveMode({ argv: ['--mode'], env: { DEVTEAM_MCP_MODE: 'full' }, warn })).toBe('readonly')
    expect(calls).toHaveLength(1)
  })

  test('TC-40: project-scoped CHƯA được nhận (D13)', () => {
    for (const opts of [
      { argv: [] as string[], env: { DEVTEAM_MCP_MODE: 'project-scoped' } },
      { argv: ['--mode=project-scoped'], env: {} as Record<string, string> },
    ]) {
      const { calls, warn } = spyWarn()
      expect(resolveMode({ ...opts, warn })).toBe('readonly')
      expect(calls).toHaveLength(1)
    }
  })

  test('TC-41: so khớp phân biệt hoa thường và không trim', () => {
    for (const raw of ['FULL', ' full', 'Full', 'full ']) {
      const { calls, warn } = spyWarn()
      expect(resolveMode({ argv: [], env: { DEVTEAM_MCP_MODE: raw }, warn })).toBe('readonly')
      expect(calls).toHaveLength(1)
    }
  })

  test('TC-42: cảnh báo nêu giá trị đã nhận, danh sách hợp lệ và mặc định', () => {
    const { calls, warn } = spyWarn()
    resolveMode({ argv: [], env: { DEVTEAM_MCP_MODE: 'bogus' }, warn })
    const msg = calls[0]
    expect(msg).toContain('bogus')
    expect(msg).toContain('readonly')
    expect(msg).toContain('full')
  })

  test('TC-43: warn mặc định ghi stderr, KHÔNG ghi stdout', () => {
    const errChunks: string[] = []
    const outChunks: string[] = []
    const realErr = process.stderr.write.bind(process.stderr)
    const realOut = process.stdout.write.bind(process.stdout)
    // `stdout` là kênh JSON-RPC của stdio transport — một dòng log lạc vào đó
    // làm hỏng cả phiên MCP.
    ;(process.stderr as any).write = (chunk: any) => {
      errChunks.push(String(chunk))
      return true
    }
    ;(process.stdout as any).write = (chunk: any) => {
      outChunks.push(String(chunk))
      return true
    }
    try {
      process.env.DEVTEAM_MCP_MODE = 'bogus'
      expect(resolveMode({ argv: [] })).toBe('readonly')
    } finally {
      ;(process.stderr as any).write = realErr
      ;(process.stdout as any).write = realOut
    }
    expect(errChunks.length).toBeGreaterThanOrEqual(1)
    expect(errChunks.join('')).toContain('bogus')
    expect(outChunks.join('')).toBe('')
  })

  test('TC-43b: nhánh mặc định đọc process.env (nên §1.4 bắt buộc)', () => {
    process.env.DEVTEAM_MCP_MODE = 'full'
    expect(resolveMode({ argv: [] })).toBe('full')
  })
})

describe('parseModeArg — phân biệt "không khai" với "khai sai"', () => {
  test('vắng flag → null; thiếu giá trị → chuỗi rỗng', () => {
    expect(parseModeArg([])).toBeNull()
    expect(parseModeArg(['--verbose'])).toBeNull()
    expect(parseModeArg(['--mode'])).toBe('')
    expect(parseModeArg(['--mode='])).toBe('')
    expect(parseModeArg(['--mode=full'])).toBe('full')
    expect(parseModeArg(['--mode', 'full'])).toBe('full')
  })
})

describe('allowlist theo mode', () => {
  test('TC-44: isToolEnabled — bảng quyết định', () => {
    for (const tool of READ_TOOLS) {
      expect(isToolEnabled('readonly', tool)).toBe(true)
      expect(isToolEnabled('full', tool)).toBe(true)
    }
    for (const tool of WRITE_TOOLS) {
      expect(isToolEnabled('readonly', tool)).toBe(false)
      expect(isToolEnabled('full', tool)).toBe(true)
    }
  })

  test('TC-45: tên tool không tồn tại → false (allowlist, không phải denylist)', () => {
    // `write_artifact` / `decide_hitl` hoãn 1.3.0 (D8) — case này chốt chúng
    // không lọt vào 1.2.0 qua một nhánh nào đó.
    expect(isToolEnabled('readonly', 'write_artifact')).toBe(false)
    expect(isToolEnabled('full', 'write_artifact')).toBe(false)
    expect(isToolEnabled('full', 'decide_hitl')).toBe(false)
    expect(isToolEnabled('full', '')).toBe(false)
  })

  test('TC-46: TOOL_ALLOWLIST — quan hệ tập hợp', () => {
    const ro = TOOL_ALLOWLIST.readonly
    const full = TOOL_ALLOWLIST.full
    // Tbefa5f4c thêm `get_task_context` vào READ_TOOLS (7 → 8); `create_qa`
    // vào WRITE_TOOLS là của T8e2886e0.
    expect(ro).toHaveLength(8)
    expect(full).toHaveLength(11)
    expect(new Set(ro).size).toBe(ro.length)
    expect(new Set(full).size).toBe(full.length)
    for (const tool of ro) expect(full).toContain(tool)
    expect([...full].filter((t) => !ro.includes(t)).sort()).toEqual([
      'add_project',
      'create_qa',
      'remove_project',
    ])
  })

  test('TC-47: MCP_MODES chỉ có hai giá trị (guard chống land nửa vời P3)', () => {
    expect([...MCP_MODES]).toEqual(['readonly', 'full'])
    expect(MCP_MODES).not.toContain('project-scoped' as never)
    expect(DEFAULT_MODE).toBe('readonly')
    expect(MODE_ENV_VAR).toBe('DEVTEAM_MCP_MODE')
  })

  test('isMcpMode chỉ nhận đúng hai chuỗi', () => {
    expect(isMcpMode('readonly')).toBe(true)
    expect(isMcpMode('full')).toBe(true)
    for (const bad of ['project-scoped', '', 'FULL', null, undefined, 1, {}]) {
      expect(isMcpMode(bad)).toBe(false)
    }
  })
})

// ── Tbefa5f4c · Nhóm K — đăng ký `get_task_context` (F15/F16) ────────────────
describe('Nhóm K — allowlist của get_task_context', () => {
  test('TC-K16: `isToolEnabled` true ở CẢ HAI mode', () => {
    expect(isToolEnabled('readonly', 'get_task_context')).toBe(true)
    expect(isToolEnabled('full', 'get_task_context')).toBe(true)
  })

  test('TC-K19: ⚠️ hồi quy đăng ký — tool đọc tăng đúng 1, tool ghi KHÔNG đổi', () => {
    // Danh sách trước Tbefa5f4c (sau khi T8e2886e0 port `create_qa`).
    const READ_BEFORE = [
      'list_projects',
      'get_project',
      'get_knowledge_bundle',
      'list_tasks',
      'get_task_state',
      'list_artifacts',
      'read_artifact',
    ]
    expect([...READ_TOOLS].filter((t) => !READ_BEFORE.includes(t))).toEqual(['get_task_context'])
    expect(READ_TOOLS).toHaveLength(READ_BEFORE.length + 1)
    // Mọi tool đọc cũ vẫn có mặt, đúng mode cũ.
    for (const tool of READ_BEFORE) {
      expect(isToolEnabled('readonly', tool)).toBe(true)
      expect(isToolEnabled('full', tool)).toBe(true)
    }
    // `create_qa` vẫn CHỈ ở `full`.
    expect([...WRITE_TOOLS]).toEqual(['add_project', 'create_qa', 'remove_project'])
    expect(isToolEnabled('readonly', 'create_qa')).toBe(false)
    expect(isToolEnabled('full', 'create_qa')).toBe(true)
  })
})
