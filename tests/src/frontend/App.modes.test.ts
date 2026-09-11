import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { inject, ref } from 'vue'
import { mountWithI18n as mount, createTestI18n } from '../helpers/i18n'
import App from '../../../src/frontend/App.vue'
import MonitorLayout from '@/features/monitor/components/MonitorLayout.vue'
import LogsPanel from '@/features/logs/components/LogsPanel.vue'
import StatisticsPanel from '@/features/statistics/components/StatisticsPanel.vue'
import { createContainer } from '@/frontend/container/index'
import { containerKey } from '@/frontend/shell/containerKey'
import { navigateToModeKey } from '@/frontend/shell/keys'
import { isEnabledByDefault, modeAccessToken, type ModeAccessProvider } from '@/frontend/shell/modeAccess'
import { createModeRegistry, modeRegistryToken, type ModeRegistry } from '@/frontend/shell/modeRegistry'

const modeModules = import.meta.glob('../../../src/features/*/registerMode.ts', { eager: true })

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

import { fetchLoggingConfig } from '@/features/settings/scripts/SettingsDialogApi'

const ALL_KEYS = [
  'monitor',
  'editor',
  'agentEditor',
  'quickAction',
  'knowledge',
  'runner',
  'automations',
  'logs',
  'statistics',
]

const i18n = createTestI18n('vi')
const t = (key: string, params?: Record<string, unknown>) =>
  (i18n.global.t as any)(key, params ?? {})

/**
 * Lối điều hướng "panel con đá người dùng sang mode khác" — cùng inject
 * `navigateToModeKey` như AgentNlWizard.vue / ArtifactPanel.vue. Panel của một
 * mode giả để test gọi được đúng lối vào đó, không phải lối click sidebar.
 */
let navigateFromPanel: ((key: string) => void) | undefined
const ProbePanel = {
  name: 'ProbePanel',
  setup() {
    navigateFromPanel = inject(navigateToModeKey, undefined) as ((k: string) => void) | undefined
    return () => null
  },
}

/** Provider giả — đóng vai nguồn quyết định khác (TC-D7); UI không đổi một dòng nào. */
function createStubModeAccess(registry: ModeRegistry, disabled: string[] = []) {
  const off = ref(new Set(disabled))
  const provider: ModeAccessProvider = {
    canAccessMode(key) {
      const entry = registry.getMode(key)
      if (!entry) return false
      if (entry.alwaysOn) return true
      return !off.value.has(key) && isEnabledByDefault(entry)
    },
    load: async () => {},
    applyOverrides: () => {},
  }
  return {
    provider,
    setDisabled(keys: string[]) {
      off.value = new Set(keys)
    },
  }
}

function buildHarness({
  disabled = [] as string[],
  withProbeMode = false,
} = {}) {
  const registry = createModeRegistry()
  for (const mod of Object.values(modeModules)) {
    ;(mod as { registerMode: (r: ModeRegistry) => void }).registerMode(registry)
  }
  if (withProbeMode) {
    registry.registerMode({
      key: 'probe',
      labelKey: 'common.modes.monitor',
      icon: 'monitor',
      order: 99,
      statusKind: 'paused',
      panel: ProbePanel,
    })
  }

  const access = createStubModeAccess(registry, disabled)
  const container = createContainer()
  container.register(modeRegistryToken, () => registry)
  container.register(modeAccessToken, () => access.provider)
  return { container, access }
}

function mountApp(container: ReturnType<typeof buildHarness>['container']) {
  return mount(App, {
    attachTo: document.body,
    global: { provide: { [containerKey]: container } },
  })
}

function labels(wrapper: ReturnType<typeof mountApp>) {
  return wrapper.findAll('.mode-toggle .mode-btn').map((b) => b.text())
}

describe('App — mode bị tắt (AC-3)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    localStorage.clear()
    navigateFromPanel = undefined
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(fetchLoggingConfig).mockResolvedValue({ config: { showLogsTab: true } })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
  })

  afterEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('TC-R6: không mode nào bị tắt → vẫn đủ 9 mode, đúng thứ tự, khởi động ở monitor', async () => {
    const { container } = buildHarness()
    const wrapper = mountApp(container)
    await flushPromises()

    expect(labels(wrapper)).toHaveLength(ALL_KEYS.length)
    expect(wrapper.findComponent(MonitorLayout as any).exists()).toBe(true)
  })

  it('TC-B1: statistics + logs đã tắt → biến mất khỏi sidebar, 7 mode còn lại giữ thứ tự', async () => {
    const { container } = buildHarness({ disabled: ['statistics', 'logs'] })
    const wrapper = mountApp(container)
    await flushPromises()

    const texts = labels(wrapper)
    expect(texts).toHaveLength(7)
    expect(texts.join('|')).not.toContain(t('common.modes.statistics'))
    expect(texts.join('|')).not.toContain(t('common.modes.logs'))
    expect(texts[0]).toContain(t('common.modes.monitor'))
    expect(texts[1]).toContain(t('common.modes.pipelineEditor'))
  })

  it('TC-B2: mode đã tắt không còn panel nào trong DOM và không lộ ở status bar', async () => {
    const { container } = buildHarness({ disabled: ['statistics'] })
    const wrapper = mountApp(container)
    await flushPromises()

    expect(wrapper.findComponent(StatisticsPanel as any).exists()).toBe(false)
    expect(wrapper.findAll('main.main-editor')).toHaveLength(1)
    expect(wrapper.find('footer.status').text()).not.toContain(
      t('common.status.paused.statistics'),
    )
  })

  it('TC-B3/TC-B4: lối điều hướng từ panel khác không mở được mode đã tắt', async () => {
    const { container } = buildHarness({
      disabled: ['runner', 'quickAction'],
      withProbeMode: true,
    })
    const wrapper = mountApp(container)
    await flushPromises()

    const probeIndex = labels(wrapper).length - 1
    await wrapper.findAll('.mode-toggle .mode-btn')[probeIndex].trigger('click')
    await flushPromises()
    expect(navigateFromPanel).toBeTypeOf('function')

    navigateFromPanel!('runner')
    await flushPromises()
    expect(wrapper.findComponent(ProbePanel as any).exists()).toBe(true)

    navigateFromPanel!('quickAction')
    await flushPromises()
    expect(wrapper.findComponent(ProbePanel as any).exists()).toBe(true)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('lối điều hướng vẫn mở được mode đang bật — gate không chặn nhầm', async () => {
    const { container } = buildHarness({ disabled: ['runner'], withProbeMode: true })
    const wrapper = mountApp(container)
    await flushPromises()

    const probeIndex = labels(wrapper).length - 1
    await wrapper.findAll('.mode-toggle .mode-btn')[probeIndex].trigger('click')
    await flushPromises()

    navigateFromPanel!('monitor')
    await flushPromises()
    expect(wrapper.findComponent(MonitorLayout as any).exists()).toBe(true)
  })

  it('TC-B5: tắt mode đang mở → tự về monitor, sidebar cập nhật, không reload', async () => {
    const { container, access } = buildHarness()
    const wrapper = mountApp(container)
    await flushPromises()

    const index = ALL_KEYS.indexOf('automations')
    await wrapper.findAll('.mode-toggle .mode-btn')[index].trigger('click')
    await flushPromises()
    expect(wrapper.find('footer.status').text()).toContain(
      t('common.status.paused.automations'),
    )

    access.setDisabled(['automations'])
    await flushPromises()

    expect(wrapper.findComponent(MonitorLayout as any).exists()).toBe(true)
    expect(labels(wrapper)).toHaveLength(ALL_KEYS.length - 1)
  })

  it('TC-B6: mode đã tắt không được chọn làm mode khởi động', async () => {
    const { container } = buildHarness({ disabled: ['knowledge'] })
    const wrapper = mountApp(container)
    await flushPromises()

    expect(labels(wrapper).join('|')).not.toContain(t('common.modes.knowledge'))
    expect(wrapper.findComponent(MonitorLayout as any).exists()).toBe(true)
  })

  it('TC-B7: chỉ còn monitor → dashboard vẫn dùng được, không màn hình trắng', async () => {
    const { container } = buildHarness({
      disabled: ALL_KEYS.filter((k) => k !== 'monitor'),
    })
    const wrapper = mountApp(container)
    await flushPromises()

    expect(labels(wrapper)).toHaveLength(1)
    expect(wrapper.findComponent(MonitorLayout as any).exists()).toBe(true)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('TC-B8/TC-D8: bật lại mode → xuất hiện và mở được, không cần restart', async () => {
    const { container, access } = buildHarness({ disabled: ['statistics'] })
    const wrapper = mountApp(container)
    await flushPromises()
    expect(labels(wrapper)).toHaveLength(ALL_KEYS.length - 1)

    access.setDisabled([])
    await flushPromises()
    expect(labels(wrapper)).toHaveLength(ALL_KEYS.length)

    await wrapper.findAll('.mode-toggle .mode-btn')[ALL_KEYS.indexOf('statistics')].trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(StatisticsPanel as any).exists()).toBe(true)
  })

  it('TC-D7/TC-D10: đổi provider là đủ để mọi bề mặt đổi theo — không sửa file UI nào', async () => {
    const { container } = buildHarness({ disabled: ['editor'] })
    const wrapper = mountApp(container)
    await flushPromises()

    expect(labels(wrapper).join('|')).not.toContain(t('common.modes.pipelineEditor'))
    expect(wrapper.findAll('main.main-editor')).toHaveLength(1)
  })

  it('TC-A5/TC-C6: monitor là alwaysOn — provider tắt nó cũng không mất', async () => {
    const { container } = buildHarness({ disabled: ALL_KEYS })
    const wrapper = mountApp(container)
    await flushPromises()

    expect(labels(wrapper)).toHaveLength(1)
    expect(labels(wrapper)[0]).toContain(t('common.modes.monitor'))
  })
})

describe('App — logs có hai công tắc (TC-R2, TC-R3, TC-R4)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
  })

  afterEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('TC-R2/TC-R4: cờ cũ showLogsTab=false vẫn ẩn tab Logs dù mode logs đang bật', async () => {
    vi.mocked(fetchLoggingConfig).mockResolvedValue({ config: { showLogsTab: false } })
    const { container } = buildHarness()
    const wrapper = mountApp(container)
    await flushPromises()

    expect(labels(wrapper).join('|')).not.toContain(t('common.modes.logs'))
    expect(wrapper.findComponent(LogsPanel as any).exists()).toBe(false)
  })

  it('TC-R3: cờ cũ bật nhưng mode logs tắt → vẫn ẩn (kết hợp AND)', async () => {
    vi.mocked(fetchLoggingConfig).mockResolvedValue({ config: { showLogsTab: true } })
    const { container } = buildHarness({ disabled: ['logs'] })
    const wrapper = mountApp(container)
    await flushPromises()

    expect(labels(wrapper).join('|')).not.toContain(t('common.modes.logs'))
  })

  it('cả hai công tắc bật → Logs hiện lại', async () => {
    vi.mocked(fetchLoggingConfig).mockResolvedValue({ config: { showLogsTab: true } })
    const { container } = buildHarness()
    const wrapper = mountApp(container)
    await flushPromises()

    expect(labels(wrapper).join('|')).toContain(t('common.modes.logs'))
  })
})
