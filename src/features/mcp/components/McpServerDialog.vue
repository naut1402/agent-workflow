<script setup lang="ts">
// fallow-ignore-file complexity
// xem docs/architecture/code/mcp.md §10
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { computed, onMounted, ref, watch } from 'vue'
import { saveMcpServer, testMcpServer, type McpCredentialOption, type McpProbeResponse } from '../scripts/mcpApi'
import {
  MCP_DEFAULT_AUTH_HEADER,
  MCP_DEFAULT_AUTH_SCHEME,
  MCP_DEFAULT_HTTP_PATH,
  MCP_DEFAULT_SSE_PATH,
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_MAX_TIMEOUT_MS,
  MCP_MIN_TIMEOUT_MS,
  MCP_TRANSPORTS,
  type McpServerConfig,
  type McpTransport,
} from '../schemas/mcpServer'
import { SecretMasker } from '../business/SecretMasker'
import { slugify } from '../../../shared/lib/stringUtils'
import { useApiAction } from '../../../frontend/composables/useApiAction'
import CDialog from '../../../frontend/ui/CDialog.vue'
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
  /** Bản sao đã bị xoá giá trị secret — nhắc người dùng nhập lại trước khi lưu. */
  secretsCleared?: boolean
  /** Bản sao: prefill từ `server` nhưng id derive lại từ Tên hiển thị. */
  isCopy?: boolean
  /** Id đang có trong store — chặn tạo mới/sao chép đè lên server khác. */
  takenIds?: string[]
  credentials?: McpCredentialOption[]
}>()

const emit = defineEmits<{
  close: []
  saved: [serverId: string]
}>()

const { t } = useI18nHelpers()

// xem docs/architecture/code/mcp.md §10
const isEdit = computed(() => Boolean(props.server?.id) && !props.isCopy)

const ID_MAX_LENGTH = 64

function withSuffix(base: string, n: number): string {
  const room = ID_MAX_LENGTH - String(n).length - 1
  return `${base.slice(0, room).replace(/-+$/, '')}-${n}`
}

function deriveId(rawLabel: string, taken: Set<string>): string {
  const base = slugify(rawLabel, { maxLength: ID_MAX_LENGTH, fallback: 'mcp-server' })
    .replace(/-+$/, '')
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(withSuffix(base, n))) n++
  return withSuffix(base, n)
}

const label = ref('')
const enabled = ref(true)
const transport = ref<McpTransport>('stdio')
const timeoutMs = ref(MCP_DEFAULT_TIMEOUT_MS)

const command = ref('')
const argsText = ref('')
const envRows = ref<KeyValueRow[]>([])
const cwd = ref('')

const url = ref('')
const credentialId = ref('')
const authHeader = ref('')
const authScheme = ref('')
const headerRows = ref<KeyValueRow[]>([])

const { pending: saving, run: runSave } = useApiAction()
const testing = ref(false)
const error = ref('')
const probe = ref<McpProbeResponse | null>(null)
const testedOk = ref(false)

const isStdio = computed(() => transport.value === 'stdio')
const transportOptions = computed(() =>
  MCP_TRANSPORTS.map((tr) => ({ value: tr, label: t(`mcp.transport.${tr}`) })),
)
const credentialOptions = computed(() => [
  { value: '', label: t('mcp.dialog.credentialNone') },
  ...(props.credentials || []).map((c) => ({ value: c.id, label: c.label || c.id })),
])

const derivedId = computed(() =>
  label.value.trim() ? deriveId(label.value, new Set(props.takenIds || [])) : '',
)
const effectiveId = computed(() => (isEdit.value ? props.server!.id : derivedId.value))

const ARGS_WARNING_I18N: Record<string, string> = {
  [SecretMasker.WARN_ARGS_SECRET_LITERAL]: 'mcp.warnings.argsSecretLiteral',
  [SecretMasker.WARN_ARGS_SECRET_DROPPED]: 'mcp.warnings.argsSecretDropped',
}

const parsedArgs = computed(() =>
  argsText.value.split('\n').map((a) => a.trim()).filter(Boolean),
)

// xem docs/architecture/code/mcp.md §10
const localArgsWarnings = computed(() => {
  if (!isStdio.value) return []
  const typingLiteral = SecretMasker.secretArgs(parsedArgs.value).length > 0
  const storedLiteral = parsedArgs.value.some(
    (a) => a === SecretMasker.MASK || a.endsWith(`=${SecretMasker.MASK}`),
  )
  return typingLiteral || storedLiteral ? [SecretMasker.WARN_ARGS_SECRET_LITERAL] : []
})

const apiWarnings = ref<string[]>([])
const savedWithWarnings = ref(false)
const argsWarnings = computed(() =>
  [...new Set([...localArgsWarnings.value, ...apiWarnings.value])]
    .filter((code) => code in ARGS_WARNING_I18N)
    .map((code) => ARGS_WARNING_I18N[code]),
)

const secretLikeRows = computed(() => {
  const rows = isStdio.value ? envRows.value : headerRows.value
  return new Set(rows.filter((r) => SecretMasker.looksLikeSecretLiteral(r.key, r.value)).map((r) => r.key))
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
  [label, transport, command, argsText, envRows, cwd, url, credentialId, authHeader, authScheme, headerRows, timeoutMs],
  () => {
    testedOk.value = false
    savedWithWarnings.value = false
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
  const cleanLabel = label.value.trim()
  if (!cleanLabel) {
    error.value = t('mcp.errors.labelRequired')
    return null
  }
  const base = {
    id: effectiveId.value,
    label: cleanLabel,
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
      args: parsedArgs.value,
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
    apiWarnings.value = probe.value.warnings ?? []
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
  await runSave(async () => {
    try {
      const { server, warnings } = await saveMcpServer(draft)
      apiWarnings.value = warnings ?? []
      emit('saved', server.id)
      // xem docs/architecture/code/mcp.md §10
      if (apiWarnings.value.includes(SecretMasker.WARN_ARGS_SECRET_DROPPED)) {
        savedWithWarnings.value = true
        return
      }
      emit('close')
    } catch (e: any) {
      error.value = String(e.message || e) || t('mcp.errors.saveFailed')
    }
  })
}

onMounted(applyPrefill)
</script>

<template>
  <CDialog
    class="mcp-dialog"
    :title="isEdit ? t('mcp.dialog.editTitle') : t('mcp.dialog.title')"
    :loading="saving"
    width="min(620px, 94vw)"
    @close="emit('close')"
  >
    <div v-if="error" class="err-banner banner-danger">{{ error }}</div>
    <p v-if="secretsCleared" class="warn-text">{{ t('mcp.dialog.copySecretsCleared') }}</p>

    <div class="field">
      <label class="cfg-label">
        <span class="label-with-hint">
          {{ t('mcp.dialog.labelField') }}<span class="req" aria-hidden="true">*</span>
        </span>
        <input v-model="label" class="cfg-input" />
      </label>
      <p v-if="effectiveId" class="muted id-hint">
        {{ t('mcp.dialog.idDerived', { id: effectiveId }) }}
        <InfoTooltip :text="isEdit ? t('mcp.dialog.idFrozenHint') : t('mcp.dialog.idDerivedHint')" />
      </p>
    </div>

    <div class="field">
      <span class="cfg-label">{{ t('mcp.dialog.transportField') }}</span>
      <CSelect
        v-model="transport"
        :options="transportOptions"
        :aria-label="t('mcp.dialog.transportField')"
        class="cfg-select"
      />
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
        <p v-for="key in argsWarnings" :key="key" class="warn-text">{{ t(key) }}</p>
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
        <span class="cfg-label">{{ t('mcp.dialog.credentialField') }}</span>
        <CSelect
          v-model="credentialId"
          :options="credentialOptions"
          :aria-label="t('mcp.dialog.credentialField')"
          class="cfg-select"
        />
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
      <div class="timeout-field">
        <span class="cfg-label label-with-hint">
          {{ t('mcp.dialog.timeoutField') }}
          <InfoTooltip :text="t('mcp.dialog.timeoutHint')" />
        </span>
        <input
          v-model.number="timeoutMs"
          type="number"
          class="cfg-input"
          :min="MCP_MIN_TIMEOUT_MS"
          :max="MCP_MAX_TIMEOUT_MS"
        />
      </div>
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
      <p v-for="w in probe.warnings.filter((x) => !(x in ARGS_WARNING_I18N))" :key="w" class="warn-text">
        {{ w }}
      </p>
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

    <p v-if="savedWithWarnings" class="ok-text">{{ t('mcp.dialog.savedWithWarnings') }}</p>

    <template #footer>
      <div class="modal-actions">
        <button type="button" class="btn-ghost btn-sm" :disabled="saving" @click="emit('close')">{{ t('mcp.dialog.cancel') }}</button>
        <button type="button" class="btn-primary btn-sm" :disabled="saving" @click="save">
          {{ saving ? t('mcp.dialog.saving') : t('mcp.dialog.save') }}
        </button>
      </div>
    </template>
  </CDialog>
</template>

<style scoped lang="scss">
.field { margin-bottom: 0.75rem; }
.field .cfg-input,
.field .cfg-textarea,
.field .cfg-select { width: 100%; }
.kv-row { display: flex; gap: 0.4rem; align-items: flex-end; margin-bottom: 0.35rem; }
.kv-row .cfg-input { flex: 1; min-width: 0; }
.checkbox-label { display: inline-flex; align-items: center; gap: 0.35rem; flex-direction: row; }
.req { color: var(--danger); }
.id-hint { display: inline-flex; align-items: center; gap: 0.3rem; margin: 0.25rem 0 0; }
.timeout-field { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.probe-row { display: flex; gap: 0.5rem; margin: 0.5rem 0; }
.probe-result { border-top: 1px solid var(--border); padding-top: 0.5rem; }
.tool-list { list-style: none; padding: 0; margin: 0.35rem 0 0; max-height: 180px; overflow-y: auto; }
.tool-list li { display: flex; gap: 0.5rem; font-size: 0.8rem; padding: 0.15rem 0; }
.muted { color: var(--muted); font-size: 0.8rem; }
.ok-text { color: var(--done); font-size: 0.85rem; margin: 0; }
.err-text { color: var(--danger); font-size: 0.85rem; margin: 0; }
.warn-text { color: var(--warn, var(--muted)); font-size: 0.8rem; margin: 0.25rem 0 0; }
.modal-actions { gap: 0.5rem; padding-top: 1rem; }
</style>
