import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTestI18nPlugin } from '../../../helpers/i18n'

/**
 * Nhóm M của `test-spec.md` — 5 chuỗi cứng của `BuilderChatBody` đã i18n hoá.
 *
 * Đây là ca CHARACTERIZATION: migrate chuỗi cứng sang khoá i18n 🚫 không được đổi chữ
 * người dùng đang thấy. Bản `vi` phải trùng từng ký tự với chuỗi trước thay đổi, nên
 * các hằng dưới đây chép từ `git show e961fc1^:…/BuilderChatBody.vue`, không chép từ
 * file JSON hiện tại — chép từ JSON thì ca này chỉ tự khẳng định chính nó.
 */

/** Phiên chat là phụ thuộc API (start → poll job → fetch turn); chỉ nó được thay. */
const session = {
  step: ref<string>('chatting'),
  entityType: ref<string | null>(null),
  messages: ref<{ role: string; text: string }[]>([]),
  draft: ref<Record<string, unknown> | null>(null),
  pipelineName: ref(''),
  agentScope: ref<string | null>(null),
  sending: ref(false),
  confirming: ref(false),
  error: ref<string | null>(null),
  showLongChatNudge: ref(false),
  catalogAgentIds: ref<Set<string> | null>(null),
  catalogError: ref<string | null>(null),
  sendMessage: vi.fn(async () => {}),
  confirm: vi.fn(async () => {}),
  cancel: vi.fn(),
  reset: vi.fn(),
  findInvalidPipelineAgentRefs: vi.fn(() => [] as string[]),
  profileNameError: ref<string | null>(null),
}

vi.mock('@/features/nl-chat/composables/useNlChatSession', () => ({
  useNlChatSession: () => session,
}))

const BuilderChatBody = (await import('@/features/nl-chat/components/BuilderChatBody.vue')).default

const COMPONENT_SOURCE = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../../src/features/nl-chat/components/BuilderChatBody.vue',
  ),
  'utf8',
)

/** Chữ `vi` NGUYÊN BẢN trước khi migrate — nguồn: `BuilderChatBody.vue` @ e961fc1^. */
const VI_BEFORE = {
  hint: 'Mô tả điều bạn muốn — mình sẽ hỏi thêm nếu thiếu, rồi dựng draft Task, Pipeline hoặc Agent cho bạn.',
  roleUser: 'Bạn',
  roleAssistant: 'Trợ lý',
  nudge: 'Có thể mô tả gọn lại giúp mình không?',
  done: 'Đã tạo thành công.',
}

function resetSession() {
  session.step.value = 'chatting'
  session.messages.value = []
  session.sending.value = false
  session.showLongChatNudge.value = false
  session.error.value = null
  session.draft.value = null
}

/** Bật đủ 5 nhánh v-if để cả 5 vị trí chữ cùng có mặt trong một lượt render. */
function allBranchesOn() {
  session.messages.value = [
    { role: 'user', text: 'tạo giúp mình một task' },
    { role: 'assistant', text: 'ok' },
  ]
  session.sending.value = true
  session.showLongChatNudge.value = true
  session.step.value = 'done'
}

function mountAt(locale: 'vi' | 'en') {
  return mount(BuilderChatBody, {
    props: { projectId: 'P1' },
    global: { plugins: [createTestI18nPlugin(locale)] },
  })
}

const mounted: { unmount: () => void }[] = []

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  resetSession()
})

function render(locale: 'vi' | 'en') {
  const wrapper = mountAt(locale)
  mounted.push(wrapper)
  return wrapper
}

describe('BuilderChatBody — 5 vị trí chữ đã i18n hoá', () => {
  it('TC-M02: bản `vi` giống HỆT chuỗi cứng trước thay đổi', () => {
    resetSession()
    const empty = render('vi')
    expect(empty.find('.nl-chat-hint').text()).toBe(VI_BEFORE.hint)
    empty.unmount()
    mounted.pop()

    allBranchesOn()
    const w = render('vi')
    const roles = w.findAll('.nl-chat-role').map((n) => n.text())
    expect(roles[0]).toBe(VI_BEFORE.roleUser)
    expect(roles[1]).toBe(VI_BEFORE.roleAssistant)
    // Hàng "đang gõ" dùng lại đúng nhãn trợ lý.
    expect(roles[2]).toBe(VI_BEFORE.roleAssistant)
    expect(w.find('.nl-chat-nudge').text()).toBe(VI_BEFORE.nudge)
    expect(w.find('.nl-chat-done').text()).toBe(VI_BEFORE.done)
  })

  it('TC-M01: cả 5 vị trí đổi chữ khi đổi locale', () => {
    allBranchesOn()
    const vi = render('vi')
    const viText = {
      role: vi.findAll('.nl-chat-role').map((n) => n.text()),
      nudge: vi.find('.nl-chat-nudge').text(),
      done: vi.find('.nl-chat-done').text(),
    }
    vi.unmount()
    mounted.pop()

    const en = render('en')
    expect(en.findAll('.nl-chat-role').map((n) => n.text())).not.toEqual(viText.role)
    expect(en.find('.nl-chat-nudge').text()).not.toBe(viText.nudge)
    expect(en.find('.nl-chat-done').text()).not.toBe(viText.done)

    // Và hint (nhánh messages rỗng) cũng đổi.
    en.unmount()
    mounted.pop()
    resetSession()
    const viEmpty = render('vi').find('.nl-chat-hint').text()
    mounted.pop()!.unmount()
    const enEmpty = render('en').find('.nl-chat-hint').text()
    expect(enEmpty).not.toBe(viEmpty)
    expect(enEmpty.length).toBeGreaterThan(0)
  })

  it('TC-M03: 🚫 không lộ khoá thô `nlChat.*` ra DOM ở cả hai locale', () => {
    for (const locale of ['vi', 'en'] as const) {
      allBranchesOn()
      const w = render(locale)
      expect(w.text()).not.toMatch(/nlChat\./)
      mounted.pop()!.unmount()
      resetSession()
    }
  })

  it('TC-M01b: 5 chuỗi cứng đã rời khỏi template', () => {
    for (const literal of Object.values(VI_BEFORE)) {
      expect(COMPONENT_SOURCE).not.toContain(literal)
    }
    for (const key of ['hint', 'roleUser', 'roleAssistant', 'nudge', 'done']) {
      expect(COMPONENT_SOURCE).toContain(`t('nlChat.builder.${key}')`)
    }
  })
})

/**
 * TC-M04 — chặn hồi quy NGƯỢC chiều.
 *
 * Ranh giới D3: prompt gửi LLM 🚫 không được dịch. Lập luận đó mà chỉ nằm trong rule thì
 * không có lưới nào; ca này là lưới.
 */
describe('TC-M04: prompt gửi LLM KHÔNG bị i18n hoá (ranh giới D3)', () => {
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
  const PROMPT_FILES = [
    'src/features/orchestrator/business/brief.ts',
    'src/features/nl-chat/business/nlChatCatalog.ts',
    'src/features/monitor/business/artifactActions/index.ts',
  ]

  it.each(PROMPT_FILES)('%s 🚫 không import t() / useI18n', (rel) => {
    const source = readFileSync(path.join(REPO_ROOT, rel), 'utf8')
    expect(source).not.toMatch(/from\s+['"].*plugins\/i18n/)
    expect(source).not.toMatch(/useI18nHelpers|useI18n\b/)
    expect(source).not.toMatch(/\bimport\s*\{[^}]*\bt\b[^}]*\}\s*from/)
  })
})
