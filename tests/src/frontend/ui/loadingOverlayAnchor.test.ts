import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n as mount } from '../../helpers/i18n'
import ConnectionDialog from '@/features/runner/components/ConnectionDialog.vue'
import ProviderDialog from '@/features/runner/components/ProviderDialog.vue'
import RunnerDialog from '@/features/runner/components/RunnerDialog.vue'
import ProfileSwitchDialog from '@/features/monitor/components/ProfileSwitchDialog.vue'
import CreateTaskDialog from '@/features/monitor/components/CreateTaskDialog.vue'
import KnowledgeCollectionDialog from '@/features/knowledge/components/KnowledgeCollectionDialog.vue'
import KnowledgeTagDialog from '@/features/knowledge/components/KnowledgeTagDialog.vue'
import McpServerDialog from '@/features/mcp/components/McpServerDialog.vue'
import AgentFormDialog from '@/features/agent-editor/components/AgentFormDialog.vue'
import AutomationFormDialog from '@/features/automations/components/AutomationFormDialog.vue'
import QuickActionPanel from '@/features/quick-action/components/QuickActionPanel.vue'
import quickActionVi from '@/features/quick-action/locales/vi'

vi.mock('@/features/runner/scripts/ConnectionDialogApi', () => ({
  fetchCredentials: vi.fn(async () => ({ profiles: [] })),
  saveCredential: vi.fn(async (p: any) => ({ profile: p })),
  saveConnection: vi.fn(async (c: any) => ({ connection: c })),
  scanLocalCommands: vi.fn(async () => ({ commands: [] })),
  saveCustomCommand: vi.fn(async (c: unknown) => ({ command: c })),
  deleteCustomCommand: vi.fn(async () => ({ deleted: true })),
  deleteCredential: vi.fn(async () => ({ deleted: true })),
  deleteConnection: vi.fn(async () => ({ deleted: true })),
  fetchOAuthCapabilities: vi.fn(async () => ({ providers: [] })),
  startOAuthConnect: vi.fn(async () => ({ state: 's', authorizeUrl: 'https://e.test' })),
  exchangeOAuthCode: vi.fn(async () => ({ credentialId: 'c' })),
  fetchOAuthStatus: vi.fn(async () => ({ status: 'pending' })),
  fetchAvailableModels: vi.fn(async () => ({ models: [] })),
}))
vi.mock('@/features/runner/scripts/ProviderDialogApi', () => ({
  fetchProviderConfigs: vi.fn(async () => ({ providerConfigs: [] })),
  saveProviderConfig: vi.fn(async (pc: any) => ({ providerConfig: pc })),
  deleteProviderConfig: vi.fn(async () => ({ deleted: true })),
}))
vi.mock('@/features/runner/scripts/RunnerDialogApi', () => ({
  saveRunner: vi.fn(async (r: any) => ({ runner: r })),
  submitJob: vi.fn(async () => ({ job: { id: 'j1' } })),
  fetchJob: vi.fn(async () => ({ job: { id: 'j1', status: 'done' } })),
}))
vi.mock('@/features/runner/scripts/runnerApi', () => ({
  fetchRunners: vi.fn(async () => ({ runners: [] })),
}))
vi.mock('@/features/mcp/scripts/mcpApi', () => ({
  fetchMcpServers: vi.fn(async () => ({ servers: [] })),
  saveMcpServer: vi.fn(async (s: any) => ({ server: s })),
  testMcpServer: vi.fn(async () => ({ ok: true, tools: [] })),
}))
vi.mock('@/features/pipeline-editor/scripts/ProfileManagerApi', () => ({
  fetchPipelineProfiles: vi.fn(async () => ({ profiles: [] })),
  fetchPipelineProfile: vi.fn(async () => ({ pipeline: null })),
}))
vi.mock('@/features/pipeline-editor/scripts/pipelineEditorApi', () => ({
  writePipelineConfig: vi.fn(async () => ({})),
  fetchCatalog: vi.fn(async () => ({ catalog: {} })),
}))
vi.mock('@/features/knowledge/scripts/KnowledgePanelApi', () => ({
  fetchKnowledgeList: vi.fn(async () => ({ entries: [] })),
  createKnowledgeCollection: vi.fn(async () => ({ collection: { id: 'c1' } })),
  saveKnowledgeCollection: vi.fn(async () => ({ collection: { id: 'c1' } })),
  saveKnowledgeTag: vi.fn(async () => ({ tag: 't1' })),
  renameKnowledgeTag: vi.fn(async () => ({ count: 0, metaError: '' })),
}))
vi.mock('@/features/agent-editor/scripts/agentEditorApi', () => ({
  fetchCustomAgent: vi.fn(async () => ({ agent: null })),
  saveCustomAgent: vi.fn(async () => ({ name: 'a1' })),
}))
vi.mock('@/features/quick-action/scripts/QuickActionPanelApi', () => ({
  fetchArtifactActionsCatalog: vi.fn(async () => ({ catalog: { menu: [] } })),
  saveArtifactActionsCatalog: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/features/monitor/scripts/CreateTaskDialogApi', () => ({
  createTask: vi.fn(async () => ({ task: { taskId: 'T1' }, job: null })),
  fetchGithubIssue: vi.fn(async () => ({ issue: null })),
}))

/**
 * TC-29 — cấu trúc, không phải hình ảnh.
 *
 * jsdom không có layout nên không kiểm được overlay phủ tới đâu. Thứ kiểm được
 * — và là đúng cái hỏng ở finding F1 — là overlay có bị neo BÊN TRONG một hộp
 * cuộn hay không: `.modal-body` vừa `position: relative` vừa `overflow-y: auto`
 * thì `inset: 0` lấy cỡ bằng padding box nhưng neo vào gốc NỘI DUNG, nên cuộn
 * xuống là overlay trôi ra khỏi vùng nhìn thấy.
 *
 * Bản sửa bọc hộp cuộn trong `.c-loading-host` và đặt overlay làm anh em đứng
 * trước nó, ngoài vùng cuộn.
 */
const SCROLLERS = ['modal-body', 'qa-form-body', 'knowledge-collection-body', 'automation-form-body']

function assertOverlaysOutsideScrollers(root: ParentNode, label: string) {
  // Overlay chỉ render khi `active` — ở trạng thái rảnh không có node nào để
  // bắt. Thứ bất biến và kiểm được ở mọi lúc là CHỖ NEO: `.c-loading-host`.
  const hosts = [...root.querySelectorAll('.c-loading-host')]
  expect(hosts.length, `${label}: phải có ít nhất một .c-loading-host`).toBeGreaterThan(0)
  for (const host of hosts) {
    for (const cls of SCROLLERS) {
      expect(host.classList.contains(cls), `${label}: chỗ neo không được là chính hộp cuộn .${cls}`).toBe(false)
      expect(host.closest(`.${cls}`), `${label}: chỗ neo nằm trong hộp cuộn .${cls} → overlay sẽ trôi khi cuộn`).toBe(null)
    }
    expect(host.querySelector('.modal-body, .qa-form-body'), `${label}: chỗ neo phải bọc hộp cuộn`).not.toBe(null)
  }
}

/** Dialog render qua `<Teleport to="body">` — query qua `document.body`. */
async function mountAndAssert(
  component: unknown,
  props: Record<string, unknown>,
  label: string,
  /** Vùng chỉ render sau một thao tác (panel mở form) thì mở ở đây. */
  open?: () => void | Promise<void>,
) {
  mount(component as any, { props, attachTo: document.body })
  await flushPromises()
  if (open) {
    await open()
    await flushPromises()
  }
  assertOverlaysOutsideScrollers(document.body, label)
  document.body.innerHTML = ''
}

function clickButtonByText(text: string): void {
  const btn = [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  if (!btn) throw new Error(`button not found: ${text}`)
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('TC-29 · overlay phải neo NGOÀI vùng cuộn', () => {
  it('ConnectionDialog', async () => {
    await mountAndAssert(
      ConnectionDialog,
      { providers: [], providerConfigs: [], connection: null },
      'ConnectionDialog',
    )
  })

  it('ProviderDialog', async () => {
    await mountAndAssert(ProviderDialog, { providers: [], providerConfig: null }, 'ProviderDialog')
  })

  it('RunnerDialog', async () => {
    await mountAndAssert(
      RunnerDialog,
      { runner: null, connections: [], providers: [], providerConfigs: [] },
      'RunnerDialog',
    )
  })

  it('ProfileSwitchDialog', async () => {
    await mountAndAssert(
      ProfileSwitchDialog,
      { taskId: 't1', projectId: null, hitlPending: false },
      'ProfileSwitchDialog',
    )
  })

  it('CreateTaskDialog', async () => {
    await mountAndAssert(CreateTaskDialog, { projectId: null }, 'CreateTaskDialog')
  })

  it('KnowledgeCollectionDialog', async () => {
    await mountAndAssert(
      KnowledgeCollectionDialog,
      { collection: null, tags: [], projectId: 'p1' },
      'KnowledgeCollectionDialog',
    )
  })

  it('KnowledgeTagDialog', async () => {
    await mountAndAssert(KnowledgeTagDialog, { tag: null, projectId: 'p1' }, 'KnowledgeTagDialog')
  })

  it('McpServerDialog', async () => {
    await mountAndAssert(McpServerDialog, { server: null, takenIds: [] }, 'McpServerDialog')
  })

  it('AgentFormDialog', async () => {
    await mountAndAssert(
      AgentFormDialog,
      { agent: null, initialDraft: null, projectId: null, catalog: { skills: [], agents: [] } },
      'AgentFormDialog',
    )
  })

  it('AutomationFormDialog', async () => {
    const formOptions = { tasks: [], profiles: [], runners: [], projects: [] }
    await mountAndAssert(
      AutomationFormDialog,
      {
        visible: true,
        editRule: null,
        eventTypes: [],
        formOptions,
        optionsByProject: {},
        saving: false,
        serverError: '',
      },
      'AutomationFormDialog',
    )
  })

  // Điểm duy nhất không phải dialog: hộp cuộn ở đây là `.qa-form-body`, và nó
  // chỉ render sau khi mở form.
  it('QuickActionPanel', async () => {
    await mountAndAssert(QuickActionPanel, { projectId: null }, 'QuickActionPanel', () =>
      clickButtonByText(quickActionVi.newAction),
    )
  })
})

describe('TC-29 meta · assertion bắt được đúng cấu trúc CŨ', () => {
  it('cấu trúc trước khi sửa (overlay thẳng trong .modal-body) phải ĐỎ', () => {
    const old = document.createElement('div')
    old.innerHTML = `<div class="modal"><div class="modal-head"></div>
      <div class="modal-body"><div class="c-loading-overlay"></div><input/></div></div>`
    expect(() => assertOverlaysOutsideScrollers(old, 'cấu trúc cũ')).toThrow()
  })

  it('cấu trúc sau khi sửa phải XANH', () => {
    const fixed = document.createElement('div')
    fixed.innerHTML = `<div class="modal"><div class="modal-head"></div>
      <div class="c-loading-host"><div class="c-loading-overlay"></div>
        <div class="modal-body"><input/></div></div></div>`
    expect(() => assertOverlaysOutsideScrollers(fixed, 'cấu trúc mới')).not.toThrow()
  })
})
