<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { onMounted, onUnmounted, ref } from 'vue'
import { fetchJobLog } from '../scripts/LogsPanelApi'

const props = defineProps<{ jobId: string }>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18nHelpers()

const text = ref('')
const truncated = ref(false)
const loading = ref(true)
const error = ref('')

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  emit('close')
}

let cancelled = false

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  fetchJobLog(props.jobId)
    .then((data) => {
      if (cancelled) return
      text.value = data.text || ''
      truncated.value = Boolean(data.truncated)
    })
    .catch((e: any) => {
      if (cancelled) return
      error.value = String(e?.message || e)
    })
    .finally(() => {
      if (cancelled) return
      loading.value = false
    })
})

onUnmounted(() => {
  cancelled = true
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop nested-backdrop" @click.self="emit('close')">
      <div class="modal job-log-dialog" role="dialog" aria-modal="true" aria-labelledby="job-log-dialog-title">
        <div class="modal-head">
          <span id="job-log-dialog-title">{{ jobId.slice(0, 8) }}</span>
          <button type="button" class="modal-close" @click="emit('close')">✕</button>
        </div>
        <div class="modal-body">
          <p v-if="loading" class="muted">…</p>
          <p v-else-if="error" class="err-banner">{{ error }}</p>
          <template v-else>
            <span v-if="truncated" class="muted">{{ t('logs.jobs.truncated') }}</span>
            <pre>{{ text || t('logs.jobs.logEmpty') }}</pre>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.job-log-dialog { max-width: 900px; width: min(900px, 94vw); }
.nested-backdrop { z-index: 1100; }
.muted { color: var(--text-muted); font-size: 0.85rem; }
.modal-body { display: flex; flex-direction: column; gap: 0.5rem; }
.job-log-dialog pre {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 0.75rem;
  border-radius: 6px;
  font-size: 0.78rem;
  max-height: 60vh;
  overflow: auto;
  white-space: pre-wrap;
}
.err-banner {
  background: var(--panel-2);
  color: var(--danger);
  border: 1px solid var(--danger);
  padding: 0.5rem;
  border-radius: 6px;
  margin: 0.5rem 0;
}
</style>
