import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createApp } from 'vue'
import { createTestI18n } from './helpers/i18n'
import { HostPlugin } from '@/shared/host/vuePlugin'
import { BUILTIN_PLUGINS } from '@/bootstrap/builtinPlugins'

vi.mock('@/api', () => ({
  fetchProjects: vi.fn(async () => ({ projects: [], defaultId: null })),
  fetchAutoscanConfig: vi.fn(async () => ({ config: { enabled: false, whitelist: [] } })),
  runAutoscan: vi.fn(async () => ({})),
  fetchTasks: vi.fn(async () => ({ root: '/tmp', tasks: [] })),
}))

import App from '@/App.vue'

function mountApp() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(App)
  app.use(createTestI18n())
  app.use(HostPlugin, { plugins: BUILTIN_PLUGINS })
  app.mount(root)
  return { app, root }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('App shell (registry-driven, issue #159)', () => {
  it('renders all 7 registered modes as sidebar buttons, monitor active by default', async () => {
    const { root } = mountApp()
    await flushPromises()

    const buttons = root.querySelectorAll('.mode-toggle .mode-btn')
    expect(buttons.length).toBe(7)
    expect(root.querySelector('.mode-btn.active')?.textContent).toContain('Monitor')
    expect(root.querySelector('.main-editor .monitor-layout, .main-editor')).toBeTruthy()
  })

  it('switches the mounted panel and status text when clicking another mode button', async () => {
    const { root } = mountApp()
    await flushPromises()

    const buttons = [...root.querySelectorAll('.mode-toggle .mode-btn')] as HTMLElement[]
    const logsBtn = buttons.find((b) => b.textContent?.includes('Nhật ký'))
    expect(logsBtn).toBeTruthy()
    logsBtn!.click()
    await flushPromises()

    expect(logsBtn!.classList.contains('active')).toBe(true)
    expect(root.querySelector('.status')?.textContent).toContain('nhật ký')
  })
})
