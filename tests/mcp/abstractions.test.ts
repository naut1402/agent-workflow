import { describe, expect, test } from 'bun:test'
import { AbstractMcpServer } from '../../mcp/AbstractMcpServer'
import { AbstractMcpTools, type ToolDef } from '../../mcp/AbstractMcpTools'
import { DashboardMcpServer } from '../../mcp/DashboardMcpServer'
import { TaskTools } from '../../mcp/tools/TaskTools'

class StubTools extends AbstractMcpTools {
  definitions(): ToolDef[] {
    return [
      {
        name: 'stub_read',
        access: 'read',
        hint: 'đọc stub.',
        config: { title: 'Stub read', description: 'Stub read.', inputSchema: {}, annotations: {} },
        handler: () => this.ok({}),
      },
      {
        name: 'stub_write',
        access: 'write',
        hint: 'ghi stub.',
        unavailableHint: 'Dùng stub_read thay thế.',
        config: { title: 'Stub write', description: 'Stub write.', inputSchema: {}, annotations: {} },
        handler: () => this.ok({}),
      },
    ]
  }

  rootOf(project?: string) {
    return this.requireRoot(project)
  }
}

class StubServer extends AbstractMcpServer {
  protected readonly name = 'stub'
  protected readonly version = '0.0.0'

  protected toolGroups(): AbstractMcpTools[] {
    return [new StubTools(() => ({ root: '/stub' }))]
  }
}

describe('AbstractMcpServer — không chứa chi tiết của server cụ thể', () => {
  test('resolveMode đọc env var và nhãn cảnh báo do lớp con truyền vào', () => {
    const warnings: string[] = []
    const warn = (msg: string) => warnings.push(msg)

    expect(AbstractMcpServer.resolveMode({ envVar: 'STUB_MODE', label: 'stub', argv: [], env: { STUB_MODE: 'full' }, warn })).toBe('full')
    expect(AbstractMcpServer.resolveMode({ envVar: 'STUB_MODE', label: 'stub', argv: [], env: { DEVTEAM_MCP_MODE: 'full' }, warn })).toBe('readonly')

    expect(AbstractMcpServer.resolveMode({ envVar: 'STUB_MODE', label: 'stub', argv: ['--mode=bogus'], env: {}, warn })).toBe('readonly')
    expect(warnings).toHaveLength(1)
    expect(warnings[0].startsWith('[stub mcp] unknown mode "bogus"')).toBe(true)
  })

  test('DashboardMcpServer.resolveMode dùng DEVTEAM_MCP_MODE và nhãn dev-team-dashboard', () => {
    const warnings: string[] = []
    expect(DashboardMcpServer.resolveMode({ argv: [], env: { DEVTEAM_MCP_MODE: 'full' } })).toBe('full')
    DashboardMcpServer.resolveMode({ argv: ['--mode=x'], env: {}, warn: (m) => warnings.push(m) })
    expect(warnings[0].startsWith('[dev-team-dashboard mcp] unknown mode "x"')).toBe(true)
  })

  test('instructions: dòng hint cho tool được đăng ký, câu unavailableHint cho tool bị lọc', () => {
    const readonly = new StubServer('readonly').instructions()
    expect(readonly).toContain('- `stub_read` — đọc stub.')
    expect(readonly).not.toContain('- `stub_write`')
    expect(readonly).toContain('`stub_write` KHÔNG có ở mode `readonly`. Dùng stub_read thay thế.')

    const full = new StubServer('full').instructions()
    expect(full).toContain('- `stub_write` — ghi stub.')
    expect(full).not.toContain('KHÔNG có ở mode')
  })

  test('tools() / hasTool() lọc theo quyền của mode', () => {
    expect(new StubServer('readonly').tools().map((t) => t.name)).toEqual(['stub_read'])
    expect(new StubServer('full').hasTool('stub_write')).toBe(true)
    expect(new StubServer('readonly').hasTool('stub_write')).toBe(false)
  })
})

describe('AbstractMcpTools — root resolver được tiêm vào', () => {
  test('requireRoot trả root từ resolver', () => {
    expect(new StubTools(() => ({ root: '/x' })).rootOf('p')).toEqual({ root: '/x' })
  })

  test('requireRoot chuyển lỗi của resolver thành fail not_found, giữ nguyên thông điệp', () => {
    const gate = new StubTools(() => ({ error: 'no root here' })).rootOf()
    expect('error' in gate).toBe(true)
    const error = (gate as { error: any }).error
    expect(error.isError).toBe(true)
    expect(error.content[0].text).toBe('no root here')
    expect(error._meta.error.code).toBe('not_found')
  })

  test('tool của nhóm task đi qua resolver được tiêm, không tự đọc registry', async () => {
    const seen: (string | undefined)[] = []
    const tools = new TaskTools((project) => {
      seen.push(project)
      return { error: `resolver từ chối ${project}` }
    })
    const res = await tools.listTasks({ project: 'abc' })
    expect(seen).toEqual(['abc'])
    expect(res.content[0].text).toBe('resolver từ chối abc')
  })
})

describe('DashboardMcpServer.instructions', () => {
  test('readonly: có dòng get_task_context, báo create_qa vắng', () => {
    const text = new DashboardMcpServer('readonly').instructions()
    expect(text).toContain('- `get_task_context` — ĐỌC ĐẦU PHIÊN.')
    expect(text).toContain('`create_qa` KHÔNG có ở mode `readonly`.')
    expect(text).not.toContain('- `create_qa`')
  })

  test('full: có dòng create_qa, không có câu tool vắng', () => {
    const text = new DashboardMcpServer('full').instructions()
    expect(text).toContain('- `create_qa` — tạo câu hỏi blocking')
    expect(text).not.toContain('KHÔNG có ở mode')
  })

  test('tool nhóm project không có dòng hint', () => {
    const text = new DashboardMcpServer('full').instructions()
    for (const name of ['list_projects', 'get_project', 'add_project', 'remove_project']) {
      expect(text).not.toContain(`\`${name}\``)
    }
  })
})
