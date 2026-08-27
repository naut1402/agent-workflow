import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountWithI18n as mount, createTestI18n } from './helpers/i18n'
import App from '../../src/App.vue'
import MonitorLayout from '@/features/monitor/components/MonitorLayout.vue'
import PipelineEditor from '@/features/pipeline-editor/components/PipelineEditor.vue'
import AgentEditor from '@/features/agent-editor/components/AgentEditor.vue'
import QuickActionPanel from '@/features/quick-action/components/QuickActionPanel.vue'
import KnowledgePanel from '@/features/knowledge/components/KnowledgePanel.vue'
import RunnerConfigPanel from '@/features/runner/components/RunnerConfigPanel.vue'
import AutomationsPanel from '@/features/automations/components/AutomationsPanel.vue'
import LogsPanel from '@/features/logs/components/LogsPanel.vue'
import StatisticsPanel from '@/features/statistics/components/StatisticsPanel.vue'
import { createContainer } from '@/core/container'
import { containerKey } from '@/core/shell/containerKey'
import { createModeRegistry, modeRegistryToken, type ModeRegistry } from '@/core/shell/modeRegistry'

// Cùng cơ chế auto-discovery với `main.ts` (glob thay vì import + gọi từng
// registerXMode) — App.test.ts phải exercise đúng wiring thật, không phải mock
// rời rạc, để còn là safety net cho refactor App.vue.
const modeModules = import.meta.glob('../../src/features/*/registerMode.ts', { eager: true })

vi.mock('@/features/monitor/scripts/monitorApi', () => ({
  fetchProjects: vi.fn(async () => ({ projects: [], defaultId: null })),
  fetchTasks: vi.fn(async () => ({ root: '/tmp/root', tasks: [] })),
}))
vi.mock('@/features/runner/scripts/runnerApi', () => ({
  fetchJobs: vi.fn(async () => ({ jobs: [] })),
}))
vi.mock('@/features/settings/scripts/SettingsDialogApi', () => ({
  fetchAutoscanConfig: vi.fn(async () => ({ config: { enabled: false, whitelist: [] } })),
  runAutoscan: vi.fn(async () => ({ report: {} })),
  fetchLoggingConfig: vi.fn(async () => ({ config: { showLogsTab: true } })),
}))

// VueFlow's canvas (SVG getBBox / ResizeObserver) không chạy được dưới jsdom —
// cùng cách mock với tests/src/features/pipeline-editor/components/PipelineEditor.test.ts.
vi.mock('@vue-flow/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vue-flow/core')>()
  return {
    ...actual,
    VueFlow: { name: 'VueFlow', props: ['nodes', 'edges', 'nodeTypes'], template: '<div />' },
    useVueFlow: (...args: Parameters<typeof actual.useVueFlow>) => {
      const vueFlow = actual.useVueFlow(...args)
      ;(vueFlow as unknown as { fitView: unknown }).fitView = vi.fn()
      return vueFlow
    },
  }
})

// MarkdownTextEditor (dùng thật trong KnowledgePanel/AgentSectionEditor/...) tự
// init Toast UI Editor qua `await import('@toast-ui/editor')` bên trong onMounted —
// mock riêng package đó không chặn được race "el null sau unmount" một cách ổn định
// (dynamic import bên trong .vue component, không phải static import ở test file).
// Mock hẳn component để không đụng tới Toast UI Editor.
vi.mock('@/core/ui/MarkdownTextEditor.vue', () => ({
  default: { name: 'MarkdownTextEditor', template: '<div class="markdown-editor-stub" />' },
}))

// `key` = thứ tự nút trong `.mode-toggle` (khớp thứ tự template hiện tại của App.vue).
const MODE_DEFS = [
  { key: 'monitor', labelKey: 'common.modes.monitor', statusKind: 'live', component: MonitorLayout },
  { key: 'editor', labelKey: 'common.modes.pipelineEditor', statusKind: 'paused', component: PipelineEditor },
  { key: 'agentEditor', labelKey: 'common.modes.agentEditor', statusKind: 'paused', component: AgentEditor },
  { key: 'quickAction', labelKey: 'common.modes.quickAction', statusKind: 'paused', component: QuickActionPanel },
  { key: 'knowledge', labelKey: 'common.modes.knowledge', statusKind: 'paused', component: KnowledgePanel },
  { key: 'runner', labelKey: 'common.modes.runner', statusKind: 'paused', component: RunnerConfigPanel },
  { key: 'automations', labelKey: 'common.modes.automations', statusKind: 'paused', component: AutomationsPanel },
  { key: 'logs', labelKey: 'common.modes.logs', statusKind: 'paused', component: LogsPanel },
  { key: 'statistics', labelKey: 'common.modes.statistics', statusKind: 'paused', component: StatisticsPanel },
]

const i18n = createTestI18n('vi')
const t = (key: string, params?: Record<string, unknown>) => (i18n.global.t as any)(key, params ?? {})

function buildContainer() {
  const registry = createModeRegistry()
  for (const mod of Object.values(modeModules)) {
    ;(mod as { registerMode: (registry: ModeRegistry) => void }).registerMode(registry)
  }

  const container = createContainer()
  container.register(modeRegistryToken, () => registry)
  return container
}

function mountApp(options: Record<string, any> = {}) {
  const { global: g = {}, ...rest } = options
  return mount(App, {
    attachTo: document.body,
    ...rest,
    global: {
      ...g,
      provide: { [containerKey]: buildContainer(), ...(g.provide ?? {}) },
    },
  })
}

describe('App', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Catch-all cho fetch của các panel con (KnowledgePanel/AutomationsPanel/LogsPanel/
    // StatisticsPanel/...) — App.test.ts chỉ quan tâm shell (sidebar/status/main panel),
    // không mock riêng API của từng feature con.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    )
  })

  afterEach(() => {
    document.body.innerHTML = ''
    errorSpy.mockRestore()
    warnSpy.mockRestore()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('mount app: hiện đủ 9 nút mode trong sidebar theo đúng thứ tự', async () => {
    const wrapper = mountApp()
    await flushPromises()

    const buttons = wrapper.findAll('.mode-toggle .mode-btn')
    expect(buttons).toHaveLength(MODE_DEFS.length)
    MODE_DEFS.forEach((def, i) => {
      expect(buttons[i].text()).toContain(t(def.labelKey))
    })
  })

  it.each(MODE_DEFS)(
    'mode "$key": active sidebar + status text + main panel đúng component',
    async (def) => {
      const wrapper = mountApp()
      await flushPromises()

      const index = MODE_DEFS.findIndex((m) => m.key === def.key)
      const buttons = wrapper.findAll('.mode-toggle .mode-btn')
      await buttons[index].trigger('click')
      await flushPromises()

      // Sidebar: đúng nút active, các nút khác không active.
      const buttonsAfter = wrapper.findAll('.mode-toggle .mode-btn')
      buttonsAfter.forEach((btn, i) => {
        expect(btn.classes('active')).toBe(i === index)
      })

      // Status text: 'live' cho monitor, 'paused.<mode>' cho các mode khác.
      const status = wrapper.find('footer.status')
      if (def.statusKind === 'live') {
        expect(status.text()).not.toContain(t(`common.status.paused.${def.key}`))
      } else {
        expect(status.text()).toContain(t(`common.status.paused.${def.key}`))
      }

      // Main panel: đúng component, đã mount trong <main>.
      const panel = wrapper.findComponent(def.component as any)
      expect(panel.exists()).toBe(true)

      wrapper.unmount()
    },
  )

  it('mode monitor: MonitorLayout nhận đủ 10 props + 9 event listener', async () => {
    const wrapper = mountApp()
    await flushPromises()

    const panel = wrapper.findComponent(MonitorLayout as any)
    expect(panel.exists()).toBe(true)
    const props = panel.props()
    for (const key of [
      'projects',
      'defaultProjectId',
      'selectedProjectId',
      'tasks',
      'selectedId',
      'selected',
      'openArtifact',
      'connected',
      'error',
      'lastUpdated',
    ]) {
      expect(props).toHaveProperty(key)
    }

    await panel.vm.$emit('select-task', 't-1')
    await panel.vm.$emit('open-artifact', { taskId: 't-1', name: 'a.md' })
    await panel.vm.$emit('create-task')
    await flushPromises()
    // Không throw / không có handler bị thiếu khi emit các event chính.
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('mode editor: PipelineEditor nhận đủ 5 props + update:scope / update:task-id', async () => {
    const wrapper = mountApp()
    await flushPromises()
    await wrapper.findAll('.mode-toggle .mode-btn')[1].trigger('click')
    await flushPromises()

    const panel = wrapper.findComponent(PipelineEditor as any)
    expect(panel.exists()).toBe(true)
    const props = panel.props()
    for (const key of ['scope', 'taskId', 'tasks', 'projectId', 'appSidebarCollapsed']) {
      expect(props).toHaveProperty(key)
    }

    await panel.vm.$emit('update:scope', 'task')
    await panel.vm.$emit('update:task-id', 't-9')
    await flushPromises()
    expect(wrapper.findComponent(PipelineEditor as any).props('scope')).toBe('task')
    expect(wrapper.findComponent(PipelineEditor as any).props('taskId')).toBe('t-9')
  })

  it('không có console.error / console.warn khi mount và chuyển mode', async () => {
    const wrapper = mountApp()
    await flushPromises()
    for (const btn of wrapper.findAll('.mode-toggle .mode-btn')) {
      await btn.trigger('click')
      await flushPromises()
    }
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
