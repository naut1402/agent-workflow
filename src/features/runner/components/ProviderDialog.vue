<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { slugify } from '../../../core/lib/stringUtils'
import { saveProviderConfig, deleteProviderConfig } from '../scripts/ProviderDialogApi'
import { DEFAULT_BASE_URLS } from '../scripts/agenticProviderDefaults'
import type { ProviderConfigOption, ProviderEntry } from '../types'
import CSelect from '../../../core/ui/CSelect.vue'
import InfoTooltip from '../../../core/ui/InfoTooltip.vue'

const props = defineProps<{
  providers: ProviderEntry[]
  /** When set — edit existing provider config (id preserved). */
  providerConfig?: ProviderConfigOption | null
}>()

const emit = defineEmits<{
  close: []
  saved: [providerConfigId: string]
}>()

const { t } = useI18nHelpers()

const isEdit = computed(() => Boolean(props.providerConfig?.id))

const label = ref('')
const providerId = ref('')
const baseURL = ref('')
const saving = ref(false)
const error = ref('')
const baseUrlPlaceholder = computed(() => DEFAULT_BASE_URLS[providerId.value] || '')

const aiProviders = computed(() => props.providers.filter((p) => p.kind === 'ai-provider'))
const aiProviderSelectOptions = computed(() => aiProviders.value.map((p) => ({ value: p.id, label: p.label })))

async function remove() {
  if (!props.providerConfig?.id) return
  if (!confirm(t('runner.providerDialog.deleteConfirm', { id: props.providerConfig.id }))) return
  try {
    await deleteProviderConfig(props.providerConfig.id)
    emit('close')
  } catch (e: any) {
    error.value = String(e.message || e)
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    if (!label.value.trim()) {
      error.value = t('runner.providerDialog.labelRequired')
      return
    }
    if (!providerId.value) {
      error.value = t('runner.providerDialog.interfaceRequired')
      return
    }
    const id = isEdit.value && props.providerConfig?.id
      ? props.providerConfig.id
      : slugify(label.value, { maxLength: 40, fallback: 'provider' })
    const { providerConfig } = await saveProviderConfig({
      id,
      label: label.value.trim(),
      providerId: providerId.value,
      ...(baseURL.value.trim() ? { baseURL: baseURL.value.trim() } : {}),
    })
    emit('saved', providerConfig.id)
    emit('close')
  } catch (e: any) {
    error.value = String(e.message || e)
  } finally {
    saving.value = false
  }
}

function applyPrefill() {
  const c = props.providerConfig
  if (!c?.id) {
    providerId.value = aiProviders.value[0]?.id || ''
    return
  }
  label.value = c.label || ''
  providerId.value = c.providerId || ''
  baseURL.value = typeof c.baseURL === 'string' ? c.baseURL : ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  emit('close')
}

onMounted(() => {
  applyPrefill()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop nested-backdrop" @click.self="emit('close')">
      <div
        class="modal provider-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-dialog-title"
      >
        <div class="modal-head">
          <span id="provider-dialog-title">{{
            isEdit ? t('runner.providerDialog.editTitle') : t('runner.providerDialog.title')
          }}</span>
          <button type="button" class="modal-close" :aria-label="t('runner.a11y.close')" @click="emit('close')">✕</button>
        </div>

        <div class="modal-body">
          <div v-if="error" class="err-banner">{{ error }}</div>
          <p class="muted dialog-intro">{{ t('runner.providerDialog.intro') }}</p>

          <div class="field">
            <label class="cfg-label">{{ t('runner.providerDialog.labelField') }}
              <input v-model="label" class="cfg-input" :placeholder="t('runner.providerDialog.labelPlaceholder')" />
            </label>
          </div>

          <div class="field">
            <label class="cfg-label">{{ t('runner.providerDialog.interfaceField') }}
              <CSelect
                v-model="providerId"
                :options="aiProviderSelectOptions"
                :aria-label="t('runner.providerDialog.interfaceField')"
                class="cfg-select"
              />
            </label>
          </div>

          <div class="field">
            <span class="cfg-label label-with-hint">
              {{ t('runner.connectionDialog.baseUrlField') }}
              <InfoTooltip :text="t('runner.connectionDialog.baseUrlHint')" />
            </span>
            <input v-model="baseURL" class="cfg-input" :placeholder="baseUrlPlaceholder" />
          </div>

          <div class="modal-actions">
            <button
              v-if="isEdit"
              type="button"
              class="btn-danger btn-sm"
              @click="remove"
            >
              {{ t('runner.actions.delete') }}
            </button>
            <span class="spacer" />
            <button type="button" class="btn-ghost btn-sm" @click="emit('close')">{{ t('runner.actions.cancel') }}</button>
            <button type="button" class="btn-primary btn-sm" :disabled="saving" @click="save">
              {{ saving ? t('runner.actions.saving') : t('runner.providerDialog.save') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.provider-dialog { max-width: 520px; width: min(520px, 94vw); }
.nested-backdrop { z-index: 1100; }
.dialog-intro { margin: 0 0 0.75rem; }
.field { margin-bottom: 0.75rem; }
.field .cfg-input,
.field .cfg-select { width: 100%; }
.label-with-hint { display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap; flex-direction: row; }
.muted { color: var(--muted); font-size: 0.8rem; word-break: break-all; }
.modal-body { display: flex; flex-direction: column; }
.modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: auto; padding-top: 1rem; }
.modal-actions .spacer { flex: 1; }
.err-banner {
  background: rgba(248, 81, 73, 0.12);
  border: 1px solid var(--danger);
  color: var(--danger);
  padding: 0.5rem;
  border-radius: 6px;
  margin-bottom: 0.75rem;
}
</style>
