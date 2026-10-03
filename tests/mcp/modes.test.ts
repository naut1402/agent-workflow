// Tb4241005 · TC-31 … TC-48 — mode vận hành của MCP server (vai inbound).
//
// `resolveMode` nhận `argv` / `env` / `warn` qua tham số nên phần lớn case
// truyền thẳng, không mock global. Nhánh MẶC ĐỊNH vẫn đọc `process.env`, nên
// suite vẫn phải cô lập `DEVTEAM_MCP_MODE` + `DEVTEAM_MCP_PROJECT` (§1.4 /
// TC-48): máy dev đặt `full` sẽ làm case "mặc định readonly" xanh/đỏ giả.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { DashboardMcpServer } from '../../mcp/DashboardMcpServer'
import { AbstractMcpServer, DEFAULT_MODE, MCP_MODES, MODE_ENV_VAR, type McpMode } from '../../mcp/AbstractMcpServer'

const { isMcpMode, isToolEnabled, parseModeArg, resolveMode } = AbstractMcpServer

const READ_TOOLS = [
  'get_knowledge_bundle',
  'get_project',
  'get_task_context',
  'get_task_state',
  'list_artifacts',
  'list_projects',
  'list_tasks',
  'read_artifact',
]
const WRITE_TOOLS = ['add_project', 'create_qa', 'remove_project']

function toolNames(mode: McpMode): string[] {
  return new DashboardMcpServer(mode).tools().map((t) => t.name).sort()
}

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

describe('quyền theo mode', () => {
  test('TC-44: isToolEnabled — bảng quyết định theo quyền', () => {
    expect(isToolEnabled('readonly', 'read')).toBe(true)
    expect(isToolEnabled('readonly', 'write')).toBe(false)
    expect(isToolEnabled('full', 'read')).toBe(true)
    expect(isToolEnabled('full', 'write')).toBe(true)
  })

  test('TC-45: quyền không tồn tại → false', () => {
    expect(isToolEnabled('full', 'admin' as never)).toBe(false)
    expect(isToolEnabled('full', '' as never)).toBe(false)
  })

  test('TC-46: tập tool đăng ký theo mode', () => {
    expect(toolNames('readonly')).toEqual(READ_TOOLS)
    expect(toolNames('full')).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort())
    expect(toolNames('full')).not.toContain('write_artifact')
    expect(toolNames('full')).not.toContain('decide_hitl')
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

describe('Nhóm K — đăng ký get_task_context', () => {
  test('TC-K16: get_task_context có ở CẢ HAI mode', () => {
    expect(toolNames('readonly')).toContain('get_task_context')
    expect(toolNames('full')).toContain('get_task_context')
  })

  test('TC-K19: tool ghi chỉ có ở full', () => {
    const readonly = toolNames('readonly')
    const full = toolNames('full')
    expect(full.filter((t) => !readonly.includes(t))).toEqual(WRITE_TOOLS)
    expect(readonly).not.toContain('create_qa')
    expect(full).toContain('create_qa')
  })
})
