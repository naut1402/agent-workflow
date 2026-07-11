<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  fetchCredentials,
  saveCredential,
  saveConnection,
  scanLocalCommands,
} from '../../../api'

type ConnectionKind = 'local-console' | 'ai-provider'

interface ProviderEntry {
  id: string
  kind: ConnectionKind
  label: string
}

interface RegisteredCommand {
  id: string
  command: string
  path: string
  available: boolean
  providerId: string
  flags: string[]
  custom?: boolean
}

interface CredentialProfile {
  id: string
  provider: string
  label: string
  secretRef: string
}

const props = defineProps<{
  providers: ProviderEntry[]
}>()

const emit = defineEmits<{
  close: []
  saved: [connectionId: string]
}>()

const kind = ref<ConnectionKind>('local-console')
const label = ref('')
const providerId = ref('')
const selectedCommandId = ref('')
const credentialId = ref('')
const scanning = ref(false)
const saving = ref(false)
const error = ref('')
const scanned = ref<RegisteredCommand[]>([])
const customCommands = ref<RegisteredCommand[]>([])
const credentials = ref<CredentialProfile[]>([])
const showNewCredential = ref(false)
const showRegisterCommand = ref(false)
const newCred = ref({ id: '', label: '', secretRef: 'env:ANTHROPIC_API_KEY' })
const registerDraft = ref({ command: '', path: '', flagsText: '' })
const registerError = ref('')

const aiProviders = computed(() => props.providers.filter((p) => p.kind === 'ai-provider'))

const commandOptions = computed(() => [...scanned.value, ...customCommands.value])

const selectedCommand = computed(
  () => commandOptions.value.find((c) => c.id === selectedCommandId.value) || null,
)

const filteredCredentials = computed(() =>
  credentials.value.filter((c) => !providerId.value || c.provider === providerId.value),
)

watch(
  kind,
  (k) => {
    if (k === 'ai-provider') {
      if (!aiProviders.value.some((p) => p.id === providerId.value)) {
        providerId.value = aiProviders.value[0]?.id || ''
      }
    }
  },
  { immediate: true },
)

watch(selectedCommandId, (id) => {
  const cmd = commandOptions.value.find((c) => c.id === id)
  if (cmd) {
    providerId.value = cmd.providerId
    if (!label.value.trim()) label.value = cmd.command
  }
})

function slugify(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'conn'
}

function buildConnectionId(resolvedProvider: string): string {
  const base = slugify(label.value) || resolvedProvider
  const suffix = kind.value === 'local-console' ? 'local' : 'api'
  return `${base}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
}

function inferProviderFromPath(pathOrCmd: string): string {
  const base = pathOrCmd.replace(/\\/g, '/').split('/').pop()?.replace(/\.exe$/i, '') || ''
  const known = scanned.value.find((c) => c.command === base || c.id === base)
  if (known) return known.providerId
  if (/cursor/i.test(base)) return 'cursor-cli'
  if (/codex/i.test(base)) return 'codex-cli'
  return 'claude-code-cli'
}

async function loadCredentials() {
  try {
    const data = await fetchCredentials()
    credentials.value = data.profiles || []
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function refreshScan() {
  scanning.value = true
  error.value = ''
  try {
    const data = await scanLocalCommands()
    scanned.value = (data.commands || []).map((c: any) => ({
      id: c.id,
      command: c.command,
      path: c.path || c.command,
      available: Boolean(c.available),
      providerId: c.providerId,
      flags: [],
    }))
    if (!selectedCommandId.value) {
      const firstAvail = scanned.value.find((c) => c.available) || scanned.value[0]
      if (firstAvail) selectedCommandId.value = firstAvail.id
    }
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    scanning.value = false
  }
}

function openRegisterCommand() {
  registerError.value = ''
  registerDraft.value = { command: '', path: '', flagsText: '' }
  showRegisterCommand.value = true
}

function confirmRegisterCommand() {
  registerError.value = ''
  const path = registerDraft.value.path.trim()
  if (!path) {
    registerError.value = 'Nhập CLI path'
    return
  }
  const command =
    registerDraft.value.command.trim() ||
    path.replace(/\\/g, '/').split('/').pop()?.replace(/\.exe$/i, '') ||
    'custom'
  const id = `custom-${slugify(command)}-${Date.now().toString(36).slice(-4)}`
  const entry: RegisteredCommand = {
    id,
    command,
    path,
    available: true,
    providerId: inferProviderFromPath(path),
    flags: registerDraft.value.flagsText
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean),
    custom: true,
  }
  customCommands.value.push(entry)
  selectedCommandId.value = entry.id
  if (!label.value.trim()) label.value = command
  showRegisterCommand.value = false
}

async function saveNewCredential() {
  error.value = ''
  try {
    const { profile } = await saveCredential({
      id: newCred.value.id,
      label: newCred.value.label || newCred.value.id,
      provider: providerId.value,
      secretRef: newCred.value.secretRef,
    })
    await loadCredentials()
    credentialId.value = profile.id
    showNewCredential.value = false
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function copyCredential(src: CredentialProfile) {
  error.value = ''
  const newId = `${src.id}-copy`
  try {
    const { profile } = await saveCredential({
      id: newId,
      label: `${src.label} (copy)`,
      provider: src.provider,
      secretRef: src.secretRef,
    })
    await loadCredentials()
    credentialId.value = profile.id
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    if (!label.value.trim()) {
      error.value = 'Nhập tên kết nối'
      return
    }

    if (kind.value === 'local-console') {
      const cmd = selectedCommand.value
      if (!cmd) {
        error.value = 'Chọn command hoặc đăng ký command mới'
        return
      }
      const resolvedProvider = cmd.providerId
      const id = buildConnectionId(resolvedProvider)
      const { connection } = await saveConnection({
        id,
        label: label.value.trim(),
        kind: 'local-console',
        providerId: resolvedProvider,
        cliPath: cmd.path || cmd.command,
        flags: cmd.flags || [],
      })
      emit('saved', connection.id)
      emit('close')
      return
    }

    const id = buildConnectionId(providerId.value)
    const { connection } = await saveConnection({
      id,
      label: label.value.trim(),
      kind: 'ai-provider',
      providerId: providerId.value,
      credentialId: credentialId.value,
    })
    emit('saved', connection.id)
    emit('close')
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    saving.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (showRegisterCommand.value) {
    showRegisterCommand.value = false
    return
  }
  emit('close')
}

onMounted(() => {
  loadCredentials()
  refreshScan()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div
        class="modal connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-dialog-title"
      >
        <div class="modal-head">
          <span id="connection-dialog-title">Thêm connection</span>
          <button type="button" class="modal-close" aria-label="Đóng" @click="emit('close')">✕</button>
        </div>

        <div class="modal-body">
          <div v-if="error" class="err-banner">{{ error }}</div>

          <div class="field">
            <label class="cfg-label">Tên kết nối
              <input v-model="label" class="cfg-input" placeholder="vd. Claude local" />
            </label>
          </div>

          <div class="field">
            <span class="cfg-label">Loại</span>
            <div class="kind-radios" role="radiogroup" aria-label="Loại connection">
              <label class="kind-radio">
                <input v-model="kind" type="radio" value="local-console" />
                Local console
              </label>
              <label class="kind-radio">
                <input v-model="kind" type="radio" value="ai-provider" />
                AI provider
              </label>
            </div>
          </div>

          <template v-if="kind === 'local-console'">
            <div class="field">
              <div class="row-actions">
                <label class="cfg-label" for="conn-command">Command</label>
                <div class="row-btns">
                  <button type="button" class="btn-ghost btn-sm" :disabled="scanning" @click="refreshScan">
                    {{ scanning ? 'Đang quét…' : 'Refresh' }}
                  </button>
                  <button type="button" class="btn-ghost btn-sm" @click="openRegisterCommand">
                    Đăng ký…
                  </button>
                </div>
              </div>
              <select id="conn-command" v-model="selectedCommandId" class="cfg-input">
                <option value="" disabled>Chọn command…</option>
                <option v-for="c in commandOptions" :key="c.id" :value="c.id">
                  {{ c.command }}{{ c.available ? '' : ' (không có trên PATH)' }}{{ c.custom ? ' · tuỳ chỉnh' : '' }}
                </option>
              </select>
              <p v-if="selectedCommand" class="muted path-hint">{{ selectedCommand.path }}</p>
            </div>
          </template>

          <template v-else>
            <div class="field">
              <label class="cfg-label">Provider
                <select v-model="providerId" class="cfg-input">
                  <option v-for="p in aiProviders" :key="p.id" :value="p.id">{{ p.label }}</option>
                </select>
              </label>
            </div>
            <div class="field">
              <div class="row-actions">
                <label class="cfg-label">Credential</label>
                <div class="row-btns">
                  <button type="button" class="btn-ghost btn-sm" @click="showNewCredential = !showNewCredential">
                    + Credential
                  </button>
                </div>
              </div>
              <select v-model="credentialId" class="cfg-input">
                <option value="" disabled>Chọn credential…</option>
                <option v-for="c in filteredCredentials" :key="c.id" :value="c.id">
                  {{ c.label }} ({{ c.id }})
                </option>
              </select>
              <ul v-if="filteredCredentials.length" class="cred-actions">
                <li v-for="c in filteredCredentials" :key="`copy-${c.id}`">
                  <button type="button" class="btn-ghost btn-sm" @click="copyCredential(c)">
                    Copy «{{ c.id }}»
                  </button>
                </li>
              </ul>
            </div>
            <div v-if="showNewCredential" class="new-cred">
              <div class="field">
                <label class="cfg-label">Credential ID
                  <input v-model="newCred.id" class="cfg-input" />
                </label>
              </div>
              <div class="field">
                <label class="cfg-label">Tên
                  <input v-model="newCred.label" class="cfg-input" />
                </label>
              </div>
              <div class="field">
                <label class="cfg-label">secretRef
                  <input v-model="newCred.secretRef" class="cfg-input" placeholder="env:ANTHROPIC_API_KEY" />
                </label>
              </div>
              <button type="button" class="btn-primary btn-sm" @click="saveNewCredential">Lưu credential</button>
            </div>
          </template>

          <div class="modal-actions">
            <button type="button" class="btn-ghost btn-sm" @click="emit('close')">Huỷ</button>
            <button type="button" class="btn-primary btn-sm" :disabled="saving" @click="save">
              {{ saving ? 'Đang lưu…' : 'Lưu connection' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Nested: đăng ký command tuỳ chỉnh -->
    <div
      v-if="showRegisterCommand"
      class="modal-backdrop nested-backdrop"
      @click.self="showRegisterCommand = false"
    >
      <div
        class="modal register-command-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-command-title"
      >
        <div class="modal-head">
          <span id="register-command-title">Đăng ký command</span>
          <button
            type="button"
            class="modal-close"
            aria-label="Đóng"
            @click="showRegisterCommand = false"
          >
            ✕
          </button>
        </div>
        <div class="modal-body">
          <div v-if="registerError" class="err-banner">{{ registerError }}</div>
          <div class="field">
            <label class="cfg-label">Tên command
              <input v-model="registerDraft.command" class="cfg-input" placeholder="vd. claude (tuỳ chọn)" />
            </label>
          </div>
          <div class="field">
            <label class="cfg-label">CLI path
              <input
                v-model="registerDraft.path"
                class="cfg-input"
                placeholder="claude hoặc đường dẫn đầy đủ"
              />
            </label>
          </div>
          <div class="field">
            <label class="cfg-label">Params / flags (tuỳ chọn)
              <input v-model="registerDraft.flagsText" class="cfg-input" placeholder="vd. --print" />
            </label>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn-ghost btn-sm" @click="showRegisterCommand = false">Huỷ</button>
            <button type="button" class="btn-primary btn-sm" @click="confirmRegisterCommand">Thêm vào danh sách</button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.connection-dialog { max-width: 520px; width: min(520px, 94vw); }
.register-command-dialog { max-width: 440px; width: min(440px, 92vw); }
.nested-backdrop { z-index: 1100; }
.kind-radios { display: flex; gap: 1rem; margin-top: 0.35rem; flex-wrap: wrap; }
.kind-radio {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  cursor: pointer;
  font-size: 0.9rem;
}
.field { margin-bottom: 0.75rem; }
.field .cfg-input { width: 100%; }
.row-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}
.row-btns { display: flex; gap: 0.35rem; }
.path-hint { margin: 0.35rem 0 0; }
.muted { color: var(--muted); font-size: 0.8rem; word-break: break-all; }
.cred-actions { list-style: none; padding: 0; margin: 0.4rem 0 0; display: flex; flex-wrap: wrap; gap: 0.25rem; }
.new-cred {
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
.err-banner {
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid var(--danger);
  color: var(--danger);
  padding: 0.5rem;
  border-radius: 6px;
  margin-bottom: 0.75rem;
}
</style>
