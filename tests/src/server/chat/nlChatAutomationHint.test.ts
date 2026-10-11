import { describe, expect, test } from 'bun:test'
import { buildTurnPrompt } from '../../../../src/features/nl-chat/business/nlChatSession'
import { KNOWN_AUTOMATION_EVENT_TYPES } from '../../../../src/features/automations/business/index'

// Tfb77cf90-P3 (#442) — ghim nguyên văn phần hint automation trước khi
// nlChatSession.ts đổi từ chép tay sang import hằng event + kiểu `kind` của
// automations. Prompt gửi agent phải giữ đúng từng ký tự.

describe('automation hint — nguyên văn', () => {
  test('dòng trigger event liệt kê KNOWN_AUTOMATION_EVENT_TYPES theo đúng thứ tự, nối bằng " | "', () => {
    const prompt = buildTurnPrompt({ entityType: 'automation', turnIndex: 1, message: 'm' })
    expect(prompt).toContain(
      ` - { "kind": "event", "eventType": "<một trong: ${KNOWN_AUTOMATION_EVENT_TYPES.join(' | ')}>" }\n`,
    )
  })

  test('mô tả action theo kind: runTask (create, existing) → httpRequest → runCommand', () => {
    const prompt = buildTurnPrompt({ entityType: 'automation', turnIndex: 1, message: 'm' })
    expect(prompt).toContain(
      [
        'Rule chạy khi BẤT KỲ trigger nào khớp (OR). Nhiều action chạy TUẦN TỰ theo thứ tự mảng.',
        'Mỗi action là MỘT trong:',
        ' - { "kind": "runTask", "mode": "create", "prompt": "<nội dung request.md của task mới>" } (+ optional "name", "description", "profileName", "runnerId", "projectId")',
        ' - { "kind": "runTask", "mode": "existing", "taskId": "<id task>" } (+ optional "name", "description", "runnerId", "projectId")',
        ' - { "kind": "httpRequest", "url": "<https URL>" } (+ optional "method" mặc định GET, "headers", "body")',
        ' - { "kind": "runCommand", "runnerId": "<id runner>" } (+ optional "params")',
        '"profileName" của action runTask cũng phải nằm trong section [PIPELINE PROFILE] của khối catalog — bỏ trống nghĩa là dùng pipeline mặc định.',
      ].join('\n'),
    )
  })
})
