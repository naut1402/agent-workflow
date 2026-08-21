<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { fetchJobLog } from '../scripts/LogsPanelApi'
import { parseJobLogSections, type JobLogSectionKind } from '../scripts/logSections'
import { parseMarkdown } from '../../../core/lib/markdownLib'

const props = defineProps<{ jobId: string }>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18nHelpers()

const text = ref('')
const truncated = ref(false)
const loading = ref(true)
const error = ref('')

const SECTION_LABEL: Record<JobLogSectionKind, string> = {
  meta: 'Hệ thống',
  payload: 'Payload',
  'system-prompt': 'Hệ thống',
  output: 'Phản hồi',
  result: 'Kết quả',
}
/** Rendered markdown for model-generated content; the rest is key:value text, not markdown. */
const MARKDOWN_KINDS = new Set<JobLogSectionKind>(['output', 'system-prompt'])

const sections = computed(() => parseJobLogSections(text.value))

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
            <p v-if="!text" class="muted">{{ t('logs.jobs.logEmpty') }}</p>
            <div v-else class="job-log-sections">
              <section v-for="(section, i) in sections" :key="i" class="job-log-section">
                <div class="job-log-section-head">
                  <span class="job-log-badge" :class="`job-log-badge-${section.kind}`">
                    {{ SECTION_LABEL[section.kind] }}
                  </span>
                  <span v-if="section.title" class="job-log-section-title">{{ section.title }}</span>
                </div>
                <!-- eslint-disable-next-line vue/no-v-html -- runner-generated markdown, same trust level as chat/artifacts -->
                <div
                  v-if="MARKDOWN_KINDS.has(section.kind)"
                  class="job-log-section-body md"
                  v-html="parseMarkdown(section.body)"
                ></div>
                <pre v-else class="job-log-section-body">{{ section.body }}</pre>
              </section>
            </div>
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
.job-log-sections { display: flex; flex-direction: column; gap: 0.6rem; max-height: 70vh; overflow: auto; }
.job-log-section-head { display: flex; align-items: baseline; gap: 0.5rem; margin-bottom: 0.25rem; }
.job-log-badge {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: var(--panel-2);
  color: var(--text-muted);
  border: 1px solid var(--border);
}
.job-log-badge-output { color: var(--accent); border-color: var(--accent); }
.job-log-badge-result { color: var(--success, var(--accent)); }
.job-log-section-title { font-size: 0.75rem; color: var(--text-muted); }
.job-log-section-body.md {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.75rem;
  font-size: 0.85rem;
  max-height: 60vh;
  overflow: auto;
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
