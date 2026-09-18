<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { saveMcpServer, testMcpServer, type McpProbeResponse } from '../scripts/mcpApi'
import { fetchCredentials } from '../../runner/scripts/ConnectionDialogApi'
import {
  MCP_DEFAULT_AUTH_HEADER,
  MCP_DEFAULT_AUTH_SCHEME,
  MCP_DEFAULT_HTTP_PATH,
  MCP_DEFAULT_SSE_PATH,
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_MAX_TIMEOUT_MS,
  MCP_TRANSPORTS,
  looksLikeSecretLiteral,
  sanitiseMcpServerId,
  type McpServerConfig,
  type McpTransport,
} from '../business/types'
import CSelect from '../../../frontend/ui/CSelect.vue'
import Icon from '../../../frontend/ui/Icon.vue'
import InfoTooltip from '../../../frontend/ui/InfoTooltip.vue'

interface KeyValueRow {
  key: string
  value: string
}

const props = defineProps<{
  /** null — tạo mới. */
  server?: McpServerConfig | null
}>()

const emit = defineEmits<{
  close: []
  saved: [serverId: string]
}>()

const { t } = useI18nHelpers()

const isEdit = computed(() => Boolean(props.server?.id))

const id = ref('')
const label = ref('')
const enabled = ref(true)
const transport = ref<McpTransport>('stdio')
const timeoutMs = ref(MCP_DEFAULT_TIMEOUT_MS)

// Giữ state của cả hai nhánh transport: đổi nhầm rồi đổi lại không mất phần đã gõ.
const command = ref('')
const argsText = ref('')
const envRows = ref<KeyValueRow[]>([])
const cwd = ref('')

const url = ref('')
const credentialId = ref('')
const authHeader = ref('')
const authScheme = ref('')
const headerRows = ref<KeyValueRow[]>([])

const credentials = ref<{ id: string; label: string }[]>([])
const saving = ref(false)
const testing = ref(false)
const error = ref('')
const probe = ref<McpProbeResponse | null>(null)
/** Sửa cấu hình sau khi kiểm tra OK thì kết quả cũ hết hiệu lực. */
const testedOk = ref(false)

const isStdio = computed(() => transport.value === 'stdio')
const transportOptions = computed(() =>
  MCP_TRANSPORTS.map((tr) => ({ value: tr, label: t(`mcp.transport.${tr}`) })),
)
const credentialOptions = computed(() => [
  { value: '', label: t('mcp.dialog.credentialNone') },
  ...credentials.value.map((c) => ({ value: c.id, label: c.label || c.id })),
])

/**
 * Id bị `sanitiseMcpServerId` loại ký tự lạ ở backend, và ô id khoá lại sau khi
 * lưu — gõ `my.server` mà im lặng thành `myserver` thì không sửa lại được nữa.
 */
const normalisedId = computed(() => sanitiseMcpServerId(id.value) || '')
const idWasNormalised = computed(() => {
  const typed = id.value.trim()
  return Boolean(typed) && normalisedId.value !== typed
})

const secretLikeRows = computed(() => {
  const rows = isStdio.value ? envRows.value : headerRows.value
  return new Set(rows.filter((r) => looksLikeSecretLiteral(r.key, r.value)).map((r) => r.key))
})

function toRows(record: Record<string, string> | undefined): KeyValueRow[] {
  return Object.entries(record || {}).map(([key, value]) => ({ key, value }))
}

function fromRows(rows: KeyValueRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) continue
    out[key] = row.value
  }
  return out
}

function applyPrefill() {
  const s = props.server
  if (!s) return
  id.value = s.id
  label.value = s.label || ''
  enabled.value = s.enabled !== false
  transport.value = s.transport
  timeoutMs.value = s.timeoutMs || MCP_DEFAULT_TIMEOUT_MS
  if (s.transport === 'stdio') {
    command.value = s.command
    argsText.value = (s.args || []).join('\n')
    envRows.value = toRows(s.env)
    cwd.value = s.cwd || ''
    return
  }
  url.value = s.url
  credentialId.value = s.credentialId || ''
  authHeader.value = s.authHeader || ''
  authScheme.value = s.authScheme || ''
  headerRows.value = toRows(s.headers)
}

/** Đổi transport chỉ đổi đuôi path gợi ý, không xoá URL người dùng đang gõ. */
watch(transport, (next, prev) => {
  if (next === prev) return
  if (next === 'stdio') return
  const wanted = next === 'sse' ? MCP_DEFAULT_SSE_PATH : MCP_DEFAULT_HTTP_PATH
  const other = next === 'sse' ? MCP_DEFAULT_HTTP_PATH : MCP_DEFAULT_SSE_PATH
  if (!url.value) {
    url.value = `http://127.0.0.1:3000${wanted}`
    return
  }
  if (url.value.endsWith(other)) url.value = `${url.value.slice(0, -other.length)}${wanted}`
})

watch(credentialId, (next) => {
  if (!next) return
  if (!authHeader.value) authHeader.value = MCP_DEFAULT_AUTH_HEADER
  if (!authScheme.value) authScheme.value = MCP_DEFAULT_AUTH_SCHEME
})

watch(
  [id, transport, command, argsText, envRows, cwd, url, credentialId, authHeader, authScheme, headerRows, timeoutMs],
  () => {
    testedOk.value = false
  },
  { deep: true },
)

function addRow(rows: KeyValueRow[]) {
  rows.push({ key: '', value: '' })
}

function removeRow(rows: KeyValueRow[], index: number) {
  rows.splice(index, 1)
}

function buildDraft(): McpServerConfig | null {
  const cleanId = id.value.trim()
  if (!cleanId) {
    error.value = t('mcp.errors.idRequired')
    return null
  }
  const base = {
    id: cleanId,
    label: label.value.trim() || cleanId,
    enabled: enabled.value,
    timeoutMs: Number(timeoutMs.value) || MCP_DEFAULT_TIMEOUT_MS,
  }
  if (isStdio.value) {
    if (!command.value.trim()) {
      error.value = t('mcp.errors.commandRequired')
      return null
    }
    return {
      ...base,
      transport: 'stdio',
      command: command.value.trim(),
      args: argsText.value.split('\n').map((a) => a.trim()).filter(Boolean),
      env: fromRows(envRows.value),
      ...(cwd.value.trim() ? { cwd: cwd.value.trim() } : {}),
    }
  }
  if (!url.value.trim()) {
    error.value = t('mcp.errors.urlRequired')
    return null
  }
  return {
    ...base,
    transport: transport.value === 'sse' ? 'sse' : 'http',
    url: url.value.trim(),
    credentialId: credentialId.value || null,
    ...(authHeader.value.trim() ? { authHeader: authHeader.value.trim() } : {}),
    ...(authScheme.value.trim() ? { authScheme: authScheme.value.trim() } : {}),
    headers: fromRows(headerRows.value),
  }
}

async function runTest(listTools: boolean) {
  error.value = ''
  const draft = buildDraft()
  if (!draft) return
  testing.value = true
  try {
    probe.value = await testMcpServer(draft, listTools)
    testedOk.value = probe.value.ok
  } catch (e: any) {
    error.value = String(e.message || e)
    testedOk.value = false
  } finally {
    testing.value = false
  }
}

async function save() {
  error.value = ''
  const draft = buildDraft()
  if (!draft) return
  saving.value = true
  try {
    const { server } = await saveMcpServer(draft)
    emit('saved', server.id)
    emit('close')
  } catch (e: any) {
    error.value = String(e.message || e) || t('mcp.errors.saveFailed')
  } finally {
    saving.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  emit('close')
}

onMounted(async () => {
  applyPrefill()
  window.addEventListener('keydown', onKeydown)
  try {
    const data = await fetchCredentials()
    credentials.value = data.profiles || []
  } catch {
    /* danh sách credential rỗng vẫn dùng được dialog */
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div class="modal mcp-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-dialog-title">
        <div class="modal-head">
          <span id="mcp-dialog-title">{{ isEdit ? t('mcp.dialog.editTitle') : t('mcp.dialog.title') }}</span>
          <button type="button" class="modal-close" :aria-label="t('mcp.a11y.close')" @click="emit('close')">✕</button>
        </div>

        <div class="modal-body">
          <div v-if="error" class="err-banner">{{ error }}</div>

          <div class="field">
            <label class="cfg-label">{{ t('mcp.dialog.idField') }}
              <input v-model="id" class="cfg-input" :disabled="isEdit" :placeholder="t('mcp.dialog.idPlaceholder')" />
            </label>
            <p v-if="!isEdit && idWasNormalised" class="warn-text">
              {{ t('mcp.dialog.idNormalised', { id: normalisedId }) }}
            </p>
          </div>

          <div class="field">
            <label class="cfg-label">{{ t('mcp.dialog.labelField') }}
              <input v-model="label" class="cfg-input" />
            </label>
          </div>

          <div class="field">
            <label class="cfg-label">{{ t('mcp.dialog.transportField') }}
              <CSelect
                v-model="transport"
                :options="transportOptions"
                :aria-label="t('mcp.dialog.transportField')"
                class="cfg-select"
              />
            </label>
          </div>

          <template v-if="isStdio">
            <div class="field">
              <label class="cfg-label">{{ t('mcp.dialog.commandField') }}
                <input v-model="command" class="cfg-input" :placeholder="t('mcp.dialog.commandPlaceholder')" />
              </label>
            </div>
            <div class="field">
              <span class="cfg-label label-with-hint">
                {{ t('mcp.dialog.argsField') }}
                <InfoTooltip :text="t('mcp.dialog.argsHint')" />
              </span>
              <textarea v-model="argsText" class="cfg-textarea" rows="3"></textarea>
            </div>
            <div class="field">
              <span class="cfg-label label-with-hint">
                {{ t('mcp.dialog.envField') }}
                <InfoTooltip :text="t('mcp.dialog.envHint')" />
              </span>
              <div v-for="(row, i) in envRows" :key="`env-${i}`" class="kv-row">
                <input v-model="row.key" class="cfg-input" :placeholder="t('mcp.dialog.keyPlaceholder')" />
                <input v-model="row.value" class="cfg-input" :placeholder="t('mcp.dialog.valuePlaceholder')" />
                <button
                  type="button"
                  class="icon-btn danger"
                  :title="t('mcp.dialog.removeRow')"
                  :aria-label="t('mcp.dialog.removeRow')"
                  @click="removeRow(envRows, i)"
                >
                  <Icon name="trash" />
                </button>
              </div>
              <button type="button" class="btn-ghost btn-sm" @click="addRow(envRows)">{{ t('mcp.dialog.addRow') }}</button>
            </div>
            <div class="field">
              <span class="cfg-label label-with-hint">
                {{ t('mcp.dialog.cwdField') }}
                <InfoTooltip :text="t('mcp.dialog.cwdHint')" />
              </span>
              <input v-model="cwd" class="cfg-input" />
            </div>
          </template>

          <template v-else>
            <div class="field">
              <label class="cfg-label">{{ t('mcp.dialog.urlField') }}
                <input v-model="url" class="cfg-input" />
              </label>
            </div>
            <div class="field">
              <label class="cfg-label">{{ t('mcp.dialog.credentialField') }}
                <CSelect
                  v-model="credentialId"
                  :options="credentialOptions"
                  :aria-label="t('mcp.dialog.credentialField')"
                  class="cfg-select"
                />
              </label>
            </div>
            <div class="field kv-row">
              <label class="cfg-label">{{ t('mcp.dialog.authHeaderField') }}
                <input v-model="authHeader" class="cfg-input" />
              </label>
              <label class="cfg-label">{{ t('mcp.dialog.authSchemeField') }}
                <input v-model="authScheme" class="cfg-input" />
              </label>
            </div>
            <div class="field">
              <span class="cfg-label">{{ t('mcp.dialog.headersField') }}</span>
              <div v-for="(row, i) in headerRows" :key="`hdr-${i}`" class="kv-row">
                <input v-model="row.key" class="cfg-input" :placeholder="t('mcp.dialog.keyPlaceholder')" />
                <input v-model="row.value" class="cfg-input" :placeholder="t('mcp.dialog.valuePlaceholder')" />
                <button
                  type="button"
                  class="icon-btn danger"
                  :title="t('mcp.dialog.removeRow')"
                  :aria-label="t('mcp.dialog.removeRow')"
                  @click="removeRow(headerRows, i)"
                >
                  <Icon name="trash" />
                </button>
              </div>
              <button type="button" class="btn-ghost btn-sm" @click="addRow(headerRows)">{{ t('mcp.dialog.addRow') }}</button>
            </div>
          </template>

          <p v-if="secretLikeRows.size" class="warn-text">{{ t('mcp.dialog.secretLiteralWarning') }}</p>

          <div class="field kv-row">
            <label class="cfg-label">{{ t('mcp.dialog.timeoutField') }}
              <input v-model.number="timeoutMs" type="number" class="cfg-input" min="1" :max="MCP_MAX_TIMEOUT_MS" />
            </label>
            <label class="cfg-label checkbox-label">
              <input v-model="enabled" type="checkbox" />
              {{ t('mcp.dialog.enabledField') }}
            </label>
          </div>

          <div class="probe-row">
            <button type="button" class="btn-ghost btn-sm" :disabled="testing" @click="runTest(false)">
              {{ testing ? t('mcp.dialog.testing') : t('mcp.dialog.test') }}
            </button>
            <button
              type="button"
              class="btn-ghost btn-sm"
              :disabled="testing || !testedOk"
              :title="t('mcp.dialog.listToolsHint')"
              @click="runTest(true)"
            >
              {{ t('mcp.dialog.listTools') }}
            </button>
          </div>

          <div v-if="probe" class="probe-result">
            <p :class="probe.ok ? 'ok-text' : 'err-text'">
              {{ probe.ok
                ? t('mcp.dialog.testOk', { server: probe.serverInfo ? ` — ${probe.serverInfo.name}` : '' })
                : `${t('mcp.dialog.testFailed')}: ${probe.error}` }}
            </p>
            <p v-for="w in probe.warnings" :key="w" class="warn-text">{{ w }}</p>
            <template v-if="probe.tools.length">
              <p class="muted">{{ t('mcp.dialog.toolsCount', { count: probe.tools.length }) }}</p>
              <ul class="tool-list">
                <li v-for="tool in probe.tools" :key="tool.name">
                  <strong>{{ tool.name }}</strong>
                  <span class="muted">{{ tool.description }}</span>
                </li>
              </ul>
            </template>
          </div>

          <div class="modal-actions">
            <button type="button" class="btn-ghost btn-sm" @click="emit('close')">{{ t('mcp.dialog.cancel') }}</button>
            <button type="button" class="btn-primary btn-sm" :disabled="saving" @click="save">
              {{ saving ? t('mcp.dialog.saving') : t('mcp.dialog.save') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.mcp-dialog { max-width: 620px; width: min(620px, 94vw); }
.modal-body { display: flex; flex-direction: column; overflow-y: auto; }
.field { margin-bottom: 0.75rem; }
.field .cfg-input,
.field .cfg-textarea,
.field .cfg-select { width: 100%; }
.kv-row { display: flex; gap: 0.4rem; align-items: flex-end; margin-bottom: 0.35rem; }
.kv-row .cfg-input { flex: 1; min-width: 0; }
.checkbox-label { display: inline-flex; align-items: center; gap: 0.35rem; flex-direction: row; }
.label-with-hint { display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap; flex-direction: row; }
.probe-row { display: flex; gap: 0.5rem; margin: 0.5rem 0; }
.probe-result { border-top: 1px solid var(--border); padding-top: 0.5rem; }
.tool-list { list-style: none; padding: 0; margin: 0.35rem 0 0; max-height: 180px; overflow-y: auto; }
.tool-list li { display: flex; gap: 0.5rem; font-size: 0.8rem; padding: 0.15rem 0; }
.muted { color: var(--muted); font-size: 0.8rem; }
.ok-text { color: var(--done); font-size: 0.85rem; margin: 0; }
.err-text { color: var(--danger); font-size: 0.85rem; margin: 0; }
.warn-text { color: var(--warn, var(--muted)); font-size: 0.8rem; margin: 0.25rem 0 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: auto; padding-top: 1rem; }
.err-banner {
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid var(--danger);
  color: var(--danger);
  padding: 0.5rem;
  border-radius: 6px;
  margin-bottom: 0.75rem;
}
</style>
