import { describe, expect, it } from 'vitest'
import {
  buildRunnerModelOptions,
  familyOfProviderId,
} from '@/features/runner/lib/runnerModelOptions'

// Tbfb52394 · nhóm F của test-spec — dựng danh sách option "Model" cho dialog
// cấu hình step, từ đúng response của `GET /api/runners`.
//
// Hợp đồng cốt lõi (AC-2): người dùng thấy **model**, hệ thống lưu **runner id**.
// Model không phải thực thể độc lập — nó là `connection.config.model`, còn runner
// mới là thứ trỏ tới connection, nên `value` của option luôn là runner id.

/** Response thật mang nhiều field hơn; ở đây chỉ dựng phần lib này đọc. */
function catalog(parts: {
  runners?: any[]
  connections?: any[]
  providers?: any[]
}): any {
  return { runners: [], connections: [], providers: [], ...parts }
}

const AI_CONN = { id: 'c-gemini', providerId: 'gemini-api', config: { model: 'gemini-2.5-pro' } }

describe('buildRunnerModelOptions — nhãn là model, value là runner id', () => {
  it('TC-F01: runner → connection có config.model ⇒ nhãn mang tên model', () => {
    const options = buildRunnerModelOptions(
      catalog({
        runners: [{ id: 'r-gemini', name: 'Gemini', connectionId: 'c-gemini', enabled: true }],
        connections: [AI_CONN],
      }),
    )
    expect(options).toHaveLength(1)
    expect(options[0].value).toBe('r-gemini')
    expect(options[0].label).toContain('gemini-2.5-pro')
  })

  it('TC-F02: connection không khai model ⇒ nhãn rơi về tên runner, không bao giờ rỗng', () => {
    const options = buildRunnerModelOptions(
      catalog({
        runners: [{ id: 'r-claude', name: 'Claude local', connectionId: 'c-cli', enabled: true }],
        connections: [{ id: 'c-cli', providerId: 'claude-code-cli' }],
      }),
    )
    expect(options).toEqual([{ value: 'r-claude', label: 'Claude local' }])
  })

  it('TC-F02b: không có cả model lẫn name ⇒ rơi tiếp về runner id', () => {
    const options = buildRunnerModelOptions(
      catalog({
        runners: [{ id: 'r-tron', connectionId: 'c-cli' }],
        connections: [{ id: 'c-cli', providerId: 'claude-code-cli' }],
      }),
    )
    expect(options).toEqual([{ value: 'r-tron', label: 'r-tron' }])
  })

  it('TC-F03: hai runner cùng model ⇒ hai nhãn PHẢI khác nhau', () => {
    const options = buildRunnerModelOptions(
      catalog({
        runners: [
          { id: 'r-a', name: 'Gemini A', connectionId: 'c-a' },
          { id: 'r-b', name: 'Gemini B', connectionId: 'c-b' },
        ],
        connections: [
          { id: 'c-a', providerId: 'gemini-api', config: { model: 'gemini-2.5-pro' } },
          { id: 'c-b', providerId: 'gemini-api', config: { model: 'gemini-2.5-pro' } },
        ],
      }),
    )
    expect(options.map((o) => o.value)).toEqual(['r-a', 'r-b'])
    // Hai dòng giống hệt nhau thì người dùng không biết mình đang chọn cái nào.
    expect(options[0].label).not.toBe(options[1].label)
    expect(options[0].label).toContain('gemini-2.5-pro')
    expect(options[1].label).toContain('gemini-2.5-pro')
  })

  it('TC-F03b: model trùng chỉ nhân bản cho đúng cặp trùng, runner model riêng giữ nhãn gọn', () => {
    const options = buildRunnerModelOptions(
      catalog({
        runners: [
          { id: 'r-a', name: 'A', connectionId: 'c-a' },
          { id: 'r-b', name: 'B', connectionId: 'c-b' },
          { id: 'r-c', name: 'C', connectionId: 'c-c' },
        ],
        connections: [
          { id: 'c-a', providerId: 'x-api', config: { model: 'dup' } },
          { id: 'c-b', providerId: 'x-api', config: { model: 'dup' } },
          { id: 'c-c', providerId: 'x-api', config: { model: 'rieng' } },
        ],
      }),
    )
    expect(options[2].label).toBe('rieng')
  })

  it('TC-F09: giữ nguyên thứ tự runners[] để khớp màn Runner, không tự sắp xếp', () => {
    const options = buildRunnerModelOptions(
      catalog({
        runners: [
          { id: 'c', name: 'c', connectionId: 'conn' },
          { id: 'a', name: 'a', connectionId: 'conn' },
          { id: 'b', name: 'b', connectionId: 'conn' },
        ],
        connections: [{ id: 'conn', providerId: 'x-api', config: { model: 'm' } }],
      }),
    )
    expect(options.map((o) => o.value)).toEqual(['c', 'a', 'b'])
  })
})

describe('buildRunnerModelOptions — lọc runner không chọn được', () => {
  it('TC-F04: runner enabled: false không xuất hiện', () => {
    const options = buildRunnerModelOptions(
      catalog({
        runners: [
          { id: 'r-on', name: 'On', connectionId: 'c-gemini' },
          { id: 'r-off', name: 'Off', connectionId: 'c-gemini', enabled: false },
        ],
        connections: [AI_CONN],
      }),
    )
    expect(options.map((o) => o.value)).toEqual(['r-on'])
  })

  it('TC-F05: runner họ console-command không xuất hiện — chọn xong job sẽ hỏng', () => {
    const options = buildRunnerModelOptions(
      catalog({
        runners: [
          { id: 'r-shell', name: 'Shell', connectionId: 'c-shell' },
          { id: 'r-ai', name: 'AI', connectionId: 'c-gemini' },
        ],
        connections: [{ id: 'c-shell', providerId: 'console-command' }, AI_CONN],
      }),
    )
    expect(options.map((o) => o.value)).toEqual(['r-ai'])
  })

  it('TC-F08: runner trỏ connectionId không tồn tại ⇒ bị loại, không throw', () => {
    const options = buildRunnerModelOptions(
      catalog({
        runners: [{ id: 'r-mo-coi', name: 'Mồ côi', connectionId: 'khong-co' }],
        connections: [AI_CONN],
      }),
    )
    // Không tra được provider ⇒ không khẳng định được nó chạy agent được;
    // để lọt là đúng ca TC-F05 đang chặn.
    expect(options).toEqual([])
  })
})

describe('buildRunnerModelOptions — input thiếu/hỏng', () => {
  it('TC-F06: providers rỗng/thiếu vẫn phân loại được theo quy tắc cứng', () => {
    const base = {
      runners: [{ id: 'r-ai', name: 'AI', connectionId: 'c-gemini' }],
      connections: [AI_CONN],
    }
    expect(buildRunnerModelOptions({ ...base, providers: [] } as any)).toHaveLength(1)
    expect(buildRunnerModelOptions(base as any)).toHaveLength(1)
    expect(buildRunnerModelOptions({ ...base, providers: null } as any)).toHaveLength(1)
  })

  it('TC-F06b: provider lạ (đăng ký runtime) phân loại theo catalog providers', () => {
    const input = {
      runners: [{ id: 'r-la', name: 'Lạ', connectionId: 'c-la' }],
      connections: [{ id: 'c-la', providerId: 'nha-cung-cap-la', config: { model: 'm-la' } }],
      providers: [{ id: 'nha-cung-cap-la', kind: 'ai-provider', label: 'Lạ', family: 'ai-api' }],
    }
    expect(buildRunnerModelOptions(input as any)).toEqual([{ value: 'r-la', label: 'm-la' }])
    // Không khai family ⇒ mặc định console-command ⇒ không cho chọn.
    expect(
      buildRunnerModelOptions({ ...input, providers: [{ id: 'nha-cung-cap-la' }] } as any),
    ).toEqual([])
  })

  it('TC-F07: input rỗng / null / undefined ⇒ mảng rỗng, không throw', () => {
    expect(buildRunnerModelOptions({} as any)).toEqual([])
    expect(buildRunnerModelOptions({ runners: [] } as any)).toEqual([])
    expect(buildRunnerModelOptions(null)).toEqual([])
    expect(buildRunnerModelOptions(undefined)).toEqual([])
    expect(buildRunnerModelOptions({ runners: null, connections: null } as any)).toEqual([])
  })

  it('TC-F07b: runner thiếu id bị bỏ qua — option value rỗng không lưu được', () => {
    const options = buildRunnerModelOptions(
      catalog({
        runners: [{ name: 'Không id', connectionId: 'c-gemini' }, { id: 'ok', connectionId: 'c-gemini' }],
        connections: [AI_CONN],
      }),
    )
    expect(options.map((o) => o.value)).toEqual(['ok'])
  })

  it('config.models[0] dùng được khi connection chưa mirror sang config.model', () => {
    const options = buildRunnerModelOptions(
      catalog({
        runners: [{ id: 'r', name: 'R', connectionId: 'c' }],
        connections: [{ id: 'c', providerId: 'x-api', config: { models: ['m1', 'm2'] } }],
      }),
    )
    expect(options).toEqual([{ value: 'r', label: 'm1' }])
  })
})

describe('familyOfProviderId — cùng quy tắc với providerFamilyOf của backend', () => {
  it.each([
    ['console-command', 'console-command'],
    ['anthropic-api', 'ai-api'],
    ['gemini-api', 'ai-api'],
    ['openai-compatible-api', 'ai-api'],
    ['claude-code-cli', 'agent-cli'],
    ['cursor-cli', 'agent-cli'],
    ['codex-cli', 'agent-cli'],
  ])('%s ⇒ %s', (providerId, family) => {
    expect(familyOfProviderId(providerId)).toBe(family)
  })

  it('TC-G6-08: family khai trong catalog thắng quy tắc theo id', () => {
    expect(familyOfProviderId('weird-api', [{ id: 'weird-api', family: 'agent-cli' }] as any)).toBe('agent-cli')
    expect(familyOfProviderId('la-ai', [{ id: 'la-ai', family: 'ai-api' }] as any)).toBe('ai-api')
    expect(familyOfProviderId('weird-api', [{ id: 'weird-api' }] as any)).toBe('ai-api')
  })

  it('TC-G6-09: catalog có sẵn của backend cho cùng family dù có hay không truyền providers', () => {
    const catalog = [
      { id: 'claude-code-cli', family: 'agent-cli' },
      { id: 'cursor-cli', family: 'agent-cli' },
      { id: 'codex-cli', family: 'agent-cli' },
      { id: 'console-command', family: 'console-command' },
      { id: 'anthropic-api', family: 'ai-api' },
      { id: 'openai-api', family: 'ai-api' },
      { id: 'gemini-api', family: 'ai-api' },
      { id: 'xai-api', family: 'ai-api' },
    ]
    for (const e of catalog) {
      expect(familyOfProviderId(e.id, catalog as any)).toBe(e.family)
      expect(familyOfProviderId(e.id)).toBe(e.family)
    }
  })

  it('provider id trống/không biết ⇒ console-command (mặc định an toàn)', () => {
    expect(familyOfProviderId(undefined)).toBe('console-command')
    expect(familyOfProviderId('')).toBe('console-command')
    expect(familyOfProviderId('khong-biet')).toBe('console-command')
  })
})
