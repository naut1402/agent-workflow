<script setup lang="ts">
import { useI18nHelpers } from '../composables/useI18nHelpers'
import { nextTick, ref, toRef, watch } from 'vue'
import { useJobLogStream, isJobLogTerminal } from '../composables/useJobLogStream'

const props = defineProps<{
  jobId: string | null
  /** When false the poll loop idles but keeps state. */
  active?: boolean
}>()

const { t } = useI18nHelpers()
const preRef = ref<HTMLElement | null>(null)
const activeRef = toRef(props, 'active')

const { text, status, exitCode, eof, error, polling } = useJobLogStream(
  toRef(props, 'jobId'),
  { active: activeRef, waitMs: 2500 },
)

watch(text, async () => {
  await nextTick()
  const el = preRef.value
  if (el) el.scrollTop = el.scrollHeight
})

const done = () => isJobLogTerminal(status.value) || eof.value
</script>

<template>
  <div class="job-log-stream">
    <div class="job-log-stream-head">
      <span v-if="jobId" class="job-log-stream-id">{{ t('monitor.jobLog.jobId', { id: jobId }) }}</span>
      <span v-if="status" class="job-log-stream-status" :class="{ done: done() }">{{ status }}</span>
      <span v-if="exitCode != null && exitCode !== undefined" class="muted">
        {{ t('monitor.jobLog.exitCode', { code: exitCode }) }}
      </span>
      <span v-if="polling && !done()" class="muted">{{ t('monitor.jobLog.streaming') }}</span>
    </div>
    <p v-if="error" class="job-log-stream-err">⚠ {{ error }}</p>
    <pre ref="preRef" class="job-log-stream-pre">{{ text || t('monitor.jobLog.empty') }}</pre>
    <p v-if="done() && !error" class="muted job-log-stream-done">{{ t('monitor.jobLog.finished') }}</p>
  </div>
</template>

<style scoped lang="scss">
.job-log-stream {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.job-log-stream-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.job-log-stream-id {
  font-family: var(--mono, ui-monospace, monospace);
}

.job-log-stream-status.done {
  color: var(--done);
}

.job-log-stream-pre {
  flex: 1;
  min-height: 160px;
  max-height: min(360px, 40vh);
  overflow: auto;
  margin: 0;
  padding: 10px;
  font-size: 12px;
  line-height: 1.45;
  background: var(--panel-2, var(--input-surface));
  border: 1px solid var(--border);
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
}

.job-log-stream-err {
  color: var(--danger);
  margin: 0;
  font-size: 12px;
}

.job-log-stream-done {
  margin: 0;
  font-size: 12px;
}
</style>
