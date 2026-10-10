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
  profileNameError: vi.fn((): string | null => null),
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
  session.confirming.value = false
  session.showLongChatNudge.value = false
  session.error.value = null
  session.draft.value = null
  session.entityType.value = null
  session.pipelineName.value = ''
  session.agentScope.value = null
  session.catalogAgentIds.value = null
  session.catalogError.value = null
  session.findInvalidPipelineAgentRefs.mockImplementation(() => [])
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

function mountAt(locale: 'vi' | 'en', projectId: string | null = 'P1') {
  return mount(BuilderChatBody, {
    props: { projectId },
    global: { plugins: [createTestI18nPlugin(locale)] },
  })
}

const mounted: { unmount: () => void }[] = []

afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  resetSession()
})

function render(locale: 'vi' | 'en', projectId: string | null = 'P1') {
  const wrapper = mountAt(locale, projectId)
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
 * Phần còn lại của `BuilderChatBody` (khung preview draft, placeholder, trạng thái gửi
 * lên header) cùng các thông điệp do `useNlChatSession` sinh ra. Cùng nguyên tắc
 * characterization: hằng chép từ bản trước migrate, không chép từ `nlChat.yaml`.
 */
const VI_BEFORE_REST = {
  inputPlaceholder: 'Nhập tin nhắn...',
  draftBadge: (entity: string) => `Draft ${entity}`,
  pipelineName: 'Tên pipeline',
  pipelineNamePlaceholder: 'Tên profile pipeline',
  agentScope: 'Phạm vi agent',
  agentScopeProject: 'Chỉ project hiện tại',
  agentScopeGlobal: 'Toàn cục (mọi project)',
  agentScopeNoProject: 'Chưa chọn project ở header — chọn project hoặc đổi phạm vi agent sang "Toàn cục".',
  confirm: 'Xác nhận & tạo',
  cancel: 'Huỷ',
  checkingAgents: 'Đang kiểm tra danh sách agent hợp lệ...',
  unknownAgents: (list: string) => `Agent không tồn tại trong catalog: ${list}`,
  invalidDraftJson: 'Draft JSON không hợp lệ — vui lòng sửa lại trước khi xác nhận.',
  statusCreating: (s: number) => `Đang tạo… ${s}s`,
  statusThinking: (s: number) => `Agent đang suy nghĩ… ${s}s`,
  statusErrorWith: (msg: string) => `Có lỗi: ${msg}`,
  statusError: 'Có lỗi',
  statusDone: 'Hoàn tất',
  statusReady: 'Sẵn sàng',
}

type Wrapper = ReturnType<typeof render>

function lastStatus(w: Wrapper): { kind: string; text: string } {
  const all = w.emitted('status') ?? []
  return all[all.length - 1]![0] as { kind: string; text: string }
}

function previewDraft(entity: 'task' | 'pipeline' | 'agent' | 'automation') {
  session.step.value = 'previewDraft'
  session.entityType.value = entity
  session.agentScope.value = 'project'
}

/** Mọi nhánh của khung preview cùng hiện: pipeline (tên + lỗi agent) và agent (phạm vi + thiếu project). */
async function previewTexts(locale: 'vi' | 'en') {
  previewDraft('pipeline')
  const pipeline = render(locale)
  const checking = pipeline.find('.nl-chat-error').text()
  session.catalogAgentIds.value = new Set(['ok'])
  session.findInvalidPipelineAgentRefs.mockImplementation(() => ['x', 'y'])
  await pipeline.find('.nl-chat-draft-textarea').setValue('{"steps":[]}')
  const out = {
    badge: pipeline.find('.nl-chat-entity-badge').text(),
    pipelineLabel: pipeline.find('.nl-chat-pipeline-name').text(),
    pipelinePlaceholder: pipeline.find('.nl-chat-pipeline-name input').attributes('placeholder'),
    checking,
    unknownAgents: pipeline.find('.nl-chat-error').text(),
    buttons: pipeline.findAll('.nl-chat-preview-actions button').map((b) => b.text()),
    html: pipeline.html(),
  }
  mounted.pop()!.unmount()
  resetSession()

  previewDraft('agent')
  const agent = render(locale, null)
  const result = {
    ...out,
    agentBadge: agent.find('.nl-chat-entity-badge').text(),
    agentLabel: agent.find('.nl-chat-agent-scope').text(),
    agentOptions: agent.findAll('.nl-chat-agent-scope option').map((o) => o.text()),
    noProject: agent.find('.nl-chat-error').text(),
    agentHtml: agent.html(),
  }
  mounted.pop()!.unmount()
  resetSession()
  return result
}

describe('BuilderChatBody — khung preview, placeholder và trạng thái đã i18n hoá', () => {
  it('bản `vi` của khung preview giống HỆT chuỗi cứng cũ', async () => {
    const p = await previewTexts('vi')
    expect(p.badge).toBe(VI_BEFORE_REST.draftBadge('Pipeline'))
    expect(p.agentBadge).toBe(VI_BEFORE_REST.draftBadge('Agent'))
    expect(p.pipelineLabel).toBe(VI_BEFORE_REST.pipelineName)
    expect(p.pipelinePlaceholder).toBe(VI_BEFORE_REST.pipelineNamePlaceholder)
    expect(p.checking).toBe(VI_BEFORE_REST.checkingAgents)
    expect(p.unknownAgents).toBe(VI_BEFORE_REST.unknownAgents('x, y'))
    expect(p.buttons).toEqual([VI_BEFORE_REST.confirm, VI_BEFORE_REST.cancel])
    expect(p.agentLabel.startsWith(VI_BEFORE_REST.agentScope)).toBe(true)
    expect(p.agentOptions).toEqual([VI_BEFORE_REST.agentScopeProject, VI_BEFORE_REST.agentScopeGlobal])
    expect(p.noProject).toBe(VI_BEFORE_REST.agentScopeNoProject)
  })

  it('bản `vi` của lỗi JSON draft giống HỆT chuỗi cứng cũ', async () => {
    previewDraft('task')
    const w = render('vi')
    await w.find('.nl-chat-draft-textarea').setValue('{không phải json')
    await w.findAll('.nl-chat-preview-actions button')[0]!.trigger('click')
    expect(w.find('.nl-chat-error').text()).toBe(VI_BEFORE_REST.invalidDraftJson)
    expect(session.confirm).not.toHaveBeenCalled()
  })

  it('bản `vi` của placeholder và trạng thái gửi lên header giống HỆT chuỗi cứng cũ', async () => {
    const w = render('vi')
    expect(w.find('textarea').attributes('placeholder')).toBe(VI_BEFORE_REST.inputPlaceholder)
    expect(lastStatus(w)).toEqual({ kind: 'idle', text: VI_BEFORE_REST.statusReady })

    session.sending.value = true
    await w.vm.$nextTick()
    expect(lastStatus(w)).toEqual({ kind: 'busy', text: VI_BEFORE_REST.statusThinking(0) })

    session.sending.value = false
    session.confirming.value = true
    await w.vm.$nextTick()
    expect(lastStatus(w)).toEqual({ kind: 'busy', text: VI_BEFORE_REST.statusCreating(0) })

    session.confirming.value = false
    session.error.value = 'boom'
    await w.vm.$nextTick()
    expect(lastStatus(w)).toEqual({ kind: 'error', text: VI_BEFORE_REST.statusErrorWith('boom') })

    session.error.value = null
    session.step.value = 'error'
    await w.vm.$nextTick()
    expect(lastStatus(w)).toEqual({ kind: 'error', text: VI_BEFORE_REST.statusError })

    session.step.value = 'done'
    await w.vm.$nextTick()
    expect(lastStatus(w)).toEqual({ kind: 'done', text: VI_BEFORE_REST.statusDone })
  })

  it('đổi locale thì khung preview, placeholder và trạng thái đổi theo', async () => {
    const vi = await previewTexts('vi')
    const en = await previewTexts('en')
    expect(en.pipelineLabel).not.toBe(vi.pipelineLabel)
    expect(en.pipelinePlaceholder).not.toBe(vi.pipelinePlaceholder)
    expect(en.checking).not.toBe(vi.checking)
    expect(en.unknownAgents).not.toBe(vi.unknownAgents)
    expect(en.unknownAgents).toContain('x, y')
    expect(en.buttons).not.toEqual(vi.buttons)
    expect(en.agentLabel).not.toBe(vi.agentLabel)
    expect(en.agentOptions).not.toEqual(vi.agentOptions)
    expect(en.noProject).not.toBe(vi.noProject)

    session.sending.value = true
    const viW = render('vi')
    const enW = render('en')
    expect(enW.find('textarea').attributes('placeholder')).not.toBe(viW.find('textarea').attributes('placeholder'))
    expect(lastStatus(enW).text).not.toBe(lastStatus(viW).text)
  })

  it('🚫 không lộ khoá thô `nlChat.*` ra DOM hay trạng thái ở cả hai locale', async () => {
    for (const locale of ['vi', 'en'] as const) {
      const p = await previewTexts(locale)
      expect(p.html).not.toMatch(/nlChat\./)
      expect(p.agentHtml).not.toMatch(/nlChat\./)

      for (const entity of ['task', 'automation'] as const) {
        previewDraft(entity)
        expect(render(locale).html()).not.toMatch(/nlChat\./)
        mounted.pop()!.unmount()
        resetSession()
      }

      const w = render(locale)
      expect(w.html()).not.toMatch(/nlChat\./)
      for (const patch of [
        () => (session.sending.value = true),
        () => (session.confirming.value = true),
        () => (session.error.value = 'boom'),
        () => (session.step.value = 'error'),
        () => (session.step.value = 'done'),
      ]) {
        patch()
        await w.vm.$nextTick()
        expect(lastStatus(w).text).not.toMatch(/nlChat\./)
      }
      mounted.pop()!.unmount()
      resetSession()
    }
  })

  it('chuỗi cứng cũ đã rời khỏi template', () => {
    for (const value of Object.values(VI_BEFORE_REST)) {
      if (typeof value === 'string') expect(COMPONENT_SOURCE).not.toContain(value)
    }
    for (const literal of ['Đang tạo…', 'Agent đang suy nghĩ…', 'Agent không tồn tại trong catalog']) {
      expect(COMPONENT_SOURCE).not.toContain(literal)
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
    'src/features/nl-chat/business/nlChatSession.ts',
    'src/features/nl-chat/lib/attachmentPrompt.ts',
    'src/features/nl-chat/lib/knowledgePrompt.ts',
    'src/features/monitor/business/artifactActions/index.ts',
  ]

  it.each(PROMPT_FILES)('%s 🚫 không import t() / useI18n', (rel) => {
    const source = readFileSync(path.join(REPO_ROOT, rel), 'utf8')
    expect(source).not.toMatch(/from\s+['"].*plugins\/i18n/)
    expect(source).not.toMatch(/useI18nHelpers|useI18n\b/)
    expect(source).not.toMatch(/\bimport\s*\{[^}]*\bt\b[^}]*\}\s*from/)
  })
})
