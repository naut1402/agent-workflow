// Tf2f484e2 · TC-E01 … TC-E03 — template agent và tài liệu MCP phải khớp code.
//
// `request.md` có 4 acceptance criteria, một trong số đó là "KHÔNG ghi
// output/định dạng này cứng vào template". Đó là một mệnh đề về NỘI DUNG FILE,
// nên nó chỉ kiểm được bằng cách đọc file — `design.md` §5 không có ca nào cho
// nó (test-spec §5.1).
//
// TC-E03 đóng đúng lỗ mà `docs/mcp/server.md` §7 tự khai: "không có test nào
// bắt được lệch" giữa bảng tool trong tài liệu và `tools/list` thật.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { DashboardMcpServer } from '../../mcp/DashboardMcpServer'
import { OrchestratorDecisionShape } from '../../src/features/orchestrator/schemas/orchestrator.js'
import { DECISION_SENTINEL } from '../../src/shared/lib/orchestrator.js'

const ROOT = path.resolve(import.meta.dir, '../..')

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

const TEMPLATE = 'docs/template/agents/orchestrator.md'

/** Tên tool đang ĐƯỢC ĐĂNG KÝ thật ở một mode — nguồn sự thật của mọi bảng. */
function toolNames(mode: 'readonly' | 'full'): string[] {
  return new DashboardMcpServer(mode).tools().map((t) => t.name).sort()
}

// ═══ TC-E01 ═══════════════════════════════════════════════════════════════════

describe('TC-E01: template 🚫 không chép cứng định dạng output', () => {
  test('không còn khối code mang dòng ORCHESTRATOR_DECISION', () => {
    const text = read(TEMPLATE)

    // Dịch trực tiếp câu "KHÔNG ghi output/định dạng này cứng vào template".
    expect(text).not.toContain(DECISION_SENTINEL)
    expect(text).not.toContain('"action"')
    // Khối ```…``` chép cứng một mẫu JSON là đúng thứ bị cấm.
    const fenced = text.match(/```[\s\S]*?```/g) ?? []
    for (const block of fenced) {
      expect(block).not.toContain('ORCHESTRATOR_DECISION')
      expect(block).not.toContain('stepId')
    }
    expect(text).not.toContain('## Định dạng trả lời')
  })

  test('có câu nói rõ giao thức ra lệnh DO PROMPT TỪNG LƯỢT quy định', () => {
    const text = read(TEMPLATE)
    expect(text).toContain('## Cách ra lệnh')
    expect(text).toContain('do prompt của từng lượt quy định')
    // Và nêu đủ CẢ HAI nhánh runtime — có tool thì gọi, không có thì prompt chỉ.
    expect(text).toContain('`orchestrator_decide`')
    expect(text).toMatch(/Không có ⇒ prompt sẽ chỉ rõ/)
  })
})

// ═══ TC-E02 ═══════════════════════════════════════════════════════════════════

describe('TC-E02: bảng `action` của template khớp hợp đồng quyết định', () => {
  test('tập action trong bảng = tập action schema chấp nhận', () => {
    const schemaActions = [...((OrchestratorDecisionShape.action as any)._def.values ?? [])].sort()
    expect(schemaActions).toEqual(['halt', 'respawn', 'resume', 'start', 'summary'])

    const text = read(TEMPLATE)
    // Ô đầu mỗi dòng dữ liệu của bảng `| \`<action>\` | … |`. Dòng tiêu đề
    // (`| \`action\` | Ý nghĩa | …`) bị loại ra, nó không phải một action.
    const rows = [...text.matchAll(/^\|\s*`([a-z]+)`\s*\|([^|]*)\|/gm)]
      .filter((m) => !m[2].includes('Ý nghĩa'))
      .map((m) => m[1])
    expect([...new Set(rows)].sort()).toEqual(schemaActions)
  })

  test('tool MCP và template nói về CÙNG một tập action', () => {
    const def = new DashboardMcpServer('full').tools().find((t) => t.name === 'orchestrator_decide')!
    const toolActions = [...((def.config.inputSchema.action as any)._def.values ?? [])].sort()
    const schemaActions = [...((OrchestratorDecisionShape.action as any)._def.values ?? [])].sort()
    expect(toolActions).toEqual(schemaActions)
  })
})

// ═══ TC-E03 ═══════════════════════════════════════════════════════════════════

describe('TC-E03: tài liệu MCP khớp `tools/list` thật ở từng mode', () => {
  /** Tên tool trong các ô `| \`name\` | …` của bảng §1. */
  function toolTableNames(doc: string): string[] {
    const section = doc.slice(doc.indexOf('## 1. Bảng tool'), doc.indexOf('## 2. Chạy và khai báo'))
    return [...section.matchAll(/^\|\s*`([a-z_]+)`\s*\|/gm)].map((m) => m[1]).sort()
  }

  test('bảng tool ở docs/mcp/server.md §1 liệt kê đúng 12 tool của mode full', () => {
    expect(toolTableNames(read('docs/mcp/server.md'))).toEqual(toolNames('full'))
  })

  test('bảng §1 gắn đúng cột Mode cho từng tool', () => {
    const doc = read('docs/mcp/server.md')
    const section = doc.slice(doc.indexOf('## 1. Bảng tool'), doc.indexOf('## 2. Chạy và khai báo'))
    const readOnly = new Set(toolNames('readonly'))
    for (const [, name, mode] of section.matchAll(/^\|\s*`([a-z_]+)`\s*\|\s*([^|]+?)\s*\|/gm)) {
      // Tool đọc có ở mọi mode; tool ghi chỉ ở `full`. Lệch ở đây là tài liệu
      // dạy agent gọi một tool mà mode của nó không đăng ký.
      expect(mode, name).toBe(readOnly.has(name) ? 'mọi mode' : 'chỉ `full`')
    }
  })

  test('bảng mode (§3 của server.md và README.md) liệt kê đúng tên tool từng mode', () => {
    for (const rel of ['docs/mcp/server.md', 'docs/mcp/README.md']) {
      const doc = read(rel)
      const rowOf = (mode: string) =>
        doc.split('\n').find((l) => l.startsWith(`| \`${mode}\``)) ?? ''

      const readRow = rowOf('readonly')
      expect(readRow, rel).toBeTruthy()
      for (const name of toolNames('readonly')) expect(readRow, `${rel} · ${name}`).toContain(`\`${name}\``)

      const fullRow = rowOf('full')
      expect(fullRow, rel).toBeTruthy()
      const writeOnly = toolNames('full').filter((n) => !toolNames('readonly').includes(n))
      for (const name of writeOnly) expect(fullRow, `${rel} · ${name}`).toContain(`\`${name}\``)
      // Số tool ghi phải khớp con số viết trong câu, không chỉ khớp danh sách.
      expect(fullRow, rel).toContain(`${writeOnly.length} tool ghi`)
    }
  })

  test('README.md nêu đúng tổng số tool của bảng §1', () => {
    expect(read('docs/mcp/README.md')).toContain(`bảng ${toolNames('full').length} tool`)
  })

  test('mỗi tool trong bảng §1 có mục tham chiếu §4.x tương ứng', () => {
    const doc = read('docs/mcp/server.md')
    for (const name of toolNames('full')) {
      expect(doc, name).toMatch(new RegExp(`^### 4\\.\\d+ \`${name}\``, 'm'))
    }
  })

  test('dòng cảnh báo khởi động nêu đúng tool đang thiếu, không nêu tool đang có', () => {
    // §7 của tài liệu chép nguyên văn dòng này; nó phải bám `hasTool`, 🚫 không
    // bám tên mode (ca mỏng theo test-spec §5.3 — không chốt nguyên văn câu).
    const warnings = (mode: 'readonly' | 'full') =>
      (new DashboardMcpServer(mode) as any).startupWarnings() as string[]

    const readonly = warnings('readonly').join('\n')
    expect(readonly).toContain('create_qa')
    expect(readonly).toContain('orchestrator_decide')

    expect(warnings('full')).toEqual([])
  })
})
