<script setup lang="ts">
// fallow-ignore-file complexity -- cognitive 28 của <template> đến từ các nhánh
// v-if theo tab và theo provider, không từ logic lồng sâu. test-e2e/runner.spec.ts
// và TC-80…TC-83 bám vào cấu trúc DOM hiện tại — đặc biệt bất biến `.runner-config`
// là gốc nội dung tab Runner — nên chẻ sub-component là đổi thiết kế kèm rủi ro
// e2e, không phải dọn dẹp. Xem #386 và investigate.md G12.
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { computed, ref, onMounted, watch } from 'vue'
import { fetchRunners } from '../scripts/runnerApi'
import { saveRunner, deleteRunner, setDefaultRunner, fetchConnections } from '../scripts/RunnerConfigPanelApi'
import { fetchProviderConfigs } from '../scripts/ProviderDialogApi'
import { fetchCredentials } from '../scripts/ConnectionDialogApi'
import RunnerDialog from './RunnerDialog.vue'
import Icon from '../../../frontend/ui/Icon.vue'
import CScreenLayout from '../../../frontend/ui/CScreenLayout.vue'
import McpPanel from '../../mcp/components/McpPanel.vue'
import type { McpCredentialOption } from '../../mcp/scripts/mcpApi'
import type { ProviderEntry, RunnerDraft, ConnectionOption, ProviderConfigOption } from '../types'
import { familyOfProviderId } from '../lib/runnerModelOptions'

const { t } = useI18nHelpers()

type RunnerTabKey = 'runner' | 'mcp'

const activeTab = ref<RunnerTabKey>('runner')
const tabs = computed(() => [
  { key: 'runner', label: t('runner.tabs.runner') },
  { key: 'mcp', label: t('runner.tabs.mcp') },
])

const runners = ref<RunnerDraft[]>([])
/**
 * Runner job KHÔNG pin sẽ thật sự chạy — rỗng khi default đã ghi nhận đang hỏng.
 * Dùng cho cả ngôi sao lẫn `:disabled` của nút đặt-default: default hỏng thì sao
 * phải trống, và người dùng phải bấm lại được chính runner đó sau khi sửa xong.
 */
const effectiveDefaultRunnerId = ref('')
const defaultRunnerIssue = ref<{ runnerId: string | null; reason: string } | null>(null)
const connections = ref<ConnectionOption[]>([])
const providers = ref<ProviderEntry[]>([])
const providerConfigs = ref<ProviderConfigOption[]>([])
const message = ref('')
const error = ref('')
const showRunnerDialog = ref(false)
const editingRunner = ref<RunnerDraft | null>(null)
const dialogMode = ref<'create' | 'edit' | 'copy'>('create')

const defaultIssueText = computed(() => {
  const issue = defaultRunnerIssue.value
  if (!issue) return ''
  return t(`runner.defaultIssue.${issue.reason}`, { id: issue.runnerId ?? '' })
})

function connectionOf(r: RunnerDraft): ConnectionOption | undefined {
  return connections.value.find((c) => c.id === r.connectionId)
}

/** Only Agent CLI / AI API runners may be the default AI runner. */
function canBeDefaultAi(r: RunnerDraft): boolean {
  const conn = connectionOf(r)
  const family = familyOfProviderId(conn?.providerId, providers.value)
  return family === 'agent-cli' || family === 'ai-api'
}

async function load() {
  error.value = ''
  try {
    const [rData, cData, pData] = await Promise.all([
      fetchRunners(),
      fetchConnections(),
      fetchProviderConfigs(),
    ])
    runners.value = rData.runners || []
    // Phân biệt *vắng mặt* với *null*, 🚫 không gộp bằng `??`:
    // `undefined` = payload cũ chưa có trường dẫn xuất ⇒ rơi về id đã ghi nhận.
    // `null`      = BE nói "không runner nào chạy được" ⇒ phải để trống, nếu
    //               không thì sao vẫn sáng trên runner mà job sẽ fail.
    effectiveDefaultRunnerId.value =
      rData.effectiveDefaultRunnerId !== undefined
        ? (rData.effectiveDefaultRunnerId ?? '')
        : (rData.defaultRunnerId ?? '')
    defaultRunnerIssue.value = rData.defaultRunnerIssue ?? null
    providers.value = (rData.providers || cData.providers || []) as ProviderEntry[]
    connections.value = cData.connections || rData.connections || []
    providerConfigs.value = pData.providerConfigs || []
    if (editingRunner.value?.id) {
      const updated = runners.value.find((r) => r.id === editingRunner.value?.id)
      if (updated) editingRunner.value = JSON.parse(JSON.stringify(updated))
    }
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

onMounted(load)

const mcpCredentials = ref<McpCredentialOption[]>([])

async function loadMcpCredentials() {
  const data = await fetchCredentials().catch(() => null)
  mcpCredentials.value = data?.profiles || []
}

watch(activeTab, (tab) => {
  if (tab === 'mcp') loadMcpCredentials()
})

function openNew() {
  editingRunner.value = null
  dialogMode.value = 'create'
  showRunnerDialog.value = true
  message.value = ''
}

function openEdit(r: RunnerDraft) {
  editingRunner.value = JSON.parse(JSON.stringify(r))
  dialogMode.value = 'edit'
  showRunnerDialog.value = true
  message.value = ''
}

/**
 * `<id>-copy`, `<id>-copy-2`… Cắt base TRƯỚC khi nối hậu tố để `sanitiseRunnerId`
 * (cắt 64 ký tự) không cắt mất chính phần làm nên khác biệt rồi trùng id trở lại.
 */
function uniqueRunnerId(baseId: string): string {
  const ids = new Set(runners.value.map((r) => r.id))
  const base = baseId.slice(0, 48)
  let candidate = `${base}-copy`
  let n = 2
  while (ids.has(candidate)) candidate = `${base}-copy-${n++}`
  return candidate
}

function openCopy(r: RunnerDraft, e: Event) {
  e.stopPropagation()
  editingRunner.value = {
    ...JSON.parse(JSON.stringify(r)),
    id: uniqueRunnerId(r.id),
    name: `${r.name} (copy)`,
  }
  dialogMode.value = 'copy'
  showRunnerDialog.value = true
  message.value = ''
}

function closeDialog() {
  showRunnerDialog.value = false
  editingRunner.value = null
}

async function onSaved(runnerId: string) {
  message.value = t('runner.messages.saved', { id: runnerId })
  await load()
}

function isEnabled(r: RunnerDraft): boolean {
  return r.enabled !== false
}

async function toggleEnabled(r: RunnerDraft, e: Event) {
  e.stopPropagation()
  try {
    await saveRunner({ ...r, enabled: !isEnabled(r) })
    message.value = isEnabled(r)
      ? t('runner.messages.disabled', { id: r.id })
      : t('runner.messages.enabled', { id: r.id })
    await load()
  } catch (err: any) {
    error.value = String(err.message || err)
  }
}

async function makeDefault(r: RunnerDraft, e: Event) {
  e.stopPropagation()
  if (!canBeDefaultAi(r)) {
    error.value = t('runner.messages.consoleNotDefault')
    return
  }
  try {
    await setDefaultRunner(r.id)
    message.value = `Default: ${r.id}`
    await load()
  } catch (err: any) {
    error.value = String(err.message || err)
  }
}

async function remove(r: RunnerDraft, e: Event) {
  e.stopPropagation()
  if (!confirm(t('runner.messages.confirmDelete', { id: r.id }))) return
  try {
    await deleteRunner(r.id)
    message.value = t('runner.messages.deleted')
    if (editingRunner.value?.id === r.id) closeDialog()
    await load()
  } catch (err: any) {
    error.value = String(err.message || err)
  }
}
</script>

<template>
  <CScreenLayout
    :tabs="tabs"
    :active-tab-key="activeTab"
    :tabs-aria-label="t('runner.tabs.ariaLabel')"
    @update:active-tab-key="activeTab = $event as RunnerTabKey"
  >
  <template #main>
  <!-- v-if, không v-show: chưa mở tab MCP thì không gọi /api/mcp-servers. -->
  <div v-if="activeTab === 'runner'" class="runner-config">
    <header class="runner-head">
      <h2>{{ t('runner.panel.title') }}</h2>
      <p class="muted">{{ t('runner.panel.subtitle') }}</p>
    </header>

    <div v-if="error" class="err-banner">{{ error }}</div>
    <div v-if="message" class="ok-banner">{{ message }}</div>
    <!-- Default hỏng = job không pin runner sẽ fail. Nói ra lý do để sửa được trong một bước. -->
    <div v-if="defaultIssueText" class="warn-banner">{{ defaultIssueText }}</div>

    <div class="runner-toolbar">
      <button type="button" class="btn-primary btn-sm" @click="openNew">{{ t('runner.panel.addRunner') }}</button>
    </div>

    <ul class="runner-list">
      <li v-if="!runners.length" class="empty muted">{{ t('runner.panel.empty') }}</li>
      <li
        v-for="r in runners"
        :key="r.id"
        :class="{ disabled: !isEnabled(r) }"
        @click="openEdit(r)"
      >
        <div class="runner-item-main">
          <strong>{{ r.name }}</strong>
          <span class="muted">{{ r.connectionId }}</span>
        </div>
        <div class="runner-item-actions" @click.stop>
          <button
            type="button"
            class="icon-btn"
            :class="{ active: isEnabled(r) }"
            :title="isEnabled(r) ? t('runner.toggle.disable') : t('runner.toggle.enable')"
            :aria-label="isEnabled(r) ? t('runner.toggle.disable') : t('runner.toggle.enable')"
            @click="toggleEnabled(r, $event)"
          >
            <!-- power -->
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                d="M8 2.5v5"
              />
              <path
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                d="M5.2 4.2a4.5 4.5 0 1 0 5.6 0"
              />
            </svg>
          </button>
          <button
            type="button"
            class="icon-btn"
            :class="{ active: r.id === effectiveDefaultRunnerId }"
            :disabled="r.id === effectiveDefaultRunnerId || !canBeDefaultAi(r)"
            :title="canBeDefaultAi(r) ? t('runner.panel.makeDefault') : t('runner.messages.consoleNotDefault')"
            :aria-label="canBeDefaultAi(r) ? t('runner.panel.makeDefault') : t('runner.messages.consoleNotDefault')"
            @click="makeDefault(r, $event)"
          >
            <!-- star -->
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                :fill="r.id === effectiveDefaultRunnerId ? 'currentColor' : 'none'"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linejoin="round"
                d="M8 2.2l1.6 3.3 3.6.5-2.6 2.6.6 3.6L8 10.5 4.8 12.2l.6-3.6L2.8 6l3.6-.5L8 2.2z"
              />
            </svg>
          </button>
          <button
            type="button"
            class="icon-btn"
            :title="t('runner.panel.copyRunner')"
            :aria-label="t('runner.panel.copyRunner')"
            @click="openCopy(r, $event)"
          >
            <Icon name="copy" />
          </button>
          <button
            type="button"
            class="icon-btn danger"
            :title="t('runner.panel.deleteRunner')"
            :aria-label="t('runner.panel.deleteRunner')"
            @click="remove(r, $event)"
          >
            <Icon name="trash" />
          </button>
        </div>
      </li>
    </ul>

    <RunnerDialog
      v-if="showRunnerDialog"
      :runner="editingRunner"
      :mode="dialogMode"
      :connections="connections"
      :providers="providers"
      :providerConfigs="providerConfigs"
      @close="closeDialog"
      @saved="onSaved"
      @refreshed="load"
    />
  </div>
  <McpPanel v-else :credentials="mcpCredentials" />
  </template>
  </CScreenLayout>
</template>

<style scoped lang="scss">
.runner-config { padding: 1rem 1.25rem; max-width: 960px; }
.runner-head h2 { margin: 0 0 0.25rem; font-size: 1.25rem; font-weight: 500; }
.muted { color: var(--muted); font-size: 0.85rem; }
.runner-toolbar { margin: 1rem 0 0.75rem; }
.runner-list { list-style: none; padding: 0; margin: 0; max-width: 640px; }
.runner-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  margin-bottom: 6px;
  cursor: pointer;
}
.runner-list li:hover { border-color: var(--accent); background: var(--panel-2); }
.runner-list li.disabled { opacity: 0.45; }
.runner-list li.empty { cursor: default; border-style: dashed; opacity: 1; }
.runner-list li.empty:hover { border-color: var(--border); background: transparent; }
.runner-item-main { min-width: 0; flex: 1; }
.runner-item-main strong { display: block; font-size: 0.95rem; }
.runner-item-actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex-shrink: 0;
}
.err-banner {
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid var(--danger);
  color: var(--danger);
  padding: 0.5rem;
  border-radius: 6px;
  margin: 0.5rem 0;
}
.ok-banner {
  background: rgba(63, 185, 80, 0.12);
  border: 1px solid var(--done);
  color: var(--done);
  padding: 0.5rem;
  border-radius: 6px;
  margin: 0.5rem 0;
}
.warn-banner {
  background: rgba(var(--tag-amber-rgb), 0.12);
  border: 1px solid var(--tag-amber);
  color: var(--tag-amber);
  padding: 0.5rem;
  border-radius: 6px;
  margin: 0.5rem 0;
}
</style>
