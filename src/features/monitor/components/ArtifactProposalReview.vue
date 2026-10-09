<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { onMounted, ref } from 'vue'
import { useArtifactProposal } from '../composables/useArtifactProposal'
import CDialog from '../../../frontend/ui/CDialog.vue'

// Review UI for a require_approval quick action: shows the proposed diff
// (before = real file, after = agent's edit in the scratch copy) and lets the
// user approve (apply to the real file), discard (throw the scratch away), or
// send follow-up feedback into the same CLI session. Opened by ArtifactPanel
// when a run settles at `awaiting_approval`.

const { t } = useI18nHelpers()
const props = defineProps<{
  jobId: string
  artifactName: string
}>()

const emit = defineEmits<{
  (e: 'approved'): void
  (e: 'discarded'): void
  (e: 'close'): void
}>()

const feedbackText = ref('')

const proposal = useArtifactProposal({ initialJobId: props.jobId })

onMounted(() => proposal.load())

async function onApprove() {
  if (await proposal.approve()) emit('approved')
}

async function onDiscard() {
  if (await proposal.discard()) emit('discarded')
}

async function onSendFeedback() {
  const text = feedbackText.value
  await proposal.sendFeedback(text)
  if (!proposal.error.value) feedbackText.value = ''
}
</script>

<template>
  <CDialog
    class="proposal-dialog"
    :loading="proposal.busy.value"
    :close-disabled="proposal.busy.value"
    width="min(860px, 94vw)"
    max-height="90vh"
    @close="emit('close')"
  >
    <template #title>
      {{ t('monitor.proposal.reviewTitle') }} <code>{{ proposal.artifactName.value || artifactName }}</code>
    </template>

    <p v-if="proposal.error.value" class="proposal-error">{{ proposal.error.value }}</p>
    <p v-if="proposal.statusText.value" class="proposal-status">⏳ {{ proposal.statusText.value }}</p>

    <div class="proposal-body">
      <p v-if="proposal.loading.value" class="proposal-muted">{{ t('monitor.proposal.loading') }}</p>
      <div v-else class="diff-view">
        <p v-if="!proposal.diffRows.value.length" class="proposal-muted">
          {{ t('monitor.proposal.noChanges') }}
        </p>
        <pre v-else class="diff-pre"><code
        ><span
            v-for="(row, i) in proposal.diffRows.value"
            :key="i"
            class="diff-line"
            :class="{
              'diff-add': row.type === 'add',
              'diff-del': row.type === 'del',
              'diff-context': row.type === 'context',
            }"
          >{{ row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' ' }} {{ row.text }}
</span></code></pre>
      </div>
    </div>

    <template #footer>
      <div class="proposal-feedback">
        <label class="cfg-label">
          {{ t('monitor.proposal.feedbackLabel') }}
          <textarea
            v-model="feedbackText"
            class="cfg-textarea"
            rows="3"
            :disabled="proposal.busy.value"
            :placeholder="t('monitor.proposal.feedbackPlaceholder')"
          />
        </label>
        <button
          type="button"
          class="btn-ghost btn-sm"
          :disabled="proposal.busy.value || !feedbackText.trim()"
          @click="onSendFeedback"
        >{{ t('monitor.proposal.sendFeedback') }}</button>
      </div>

      <div class="proposal-actions">
        <button type="button" class="btn-primary" :disabled="proposal.busy.value || proposal.loading.value" @click="onApprove">
          {{ t('monitor.proposal.approve') }}
        </button>
        <button type="button" class="btn-ghost btn-danger" :disabled="proposal.busy.value" @click="onDiscard">
          {{ t('monitor.proposal.discard') }}
        </button>
        <button type="button" class="btn-ghost" :disabled="proposal.busy.value" @click="emit('close')">{{ t('monitor.proposal.close') }}</button>
      </div>
    </template>
  </CDialog>
</template>

<style scoped lang="scss">
.proposal-error {
  margin: 0;
  color: var(--danger);
  font-size: 13px;
}
.proposal-status { margin: 0; color: var(--muted); font-size: 13px; }
.proposal-muted { color: var(--muted); font-size: 13px; }
.proposal-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2);
}
.diff-pre {
  margin: 0;
  padding: 8px 10px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
}
.diff-line {
  display: block;
  white-space: pre;
  padding: 0 4px;
  border-left: 3px solid transparent;
}
.diff-add {
  background: rgba(46, 160, 67, 0.16);
  border-left-color: rgba(46, 160, 67, 0.9);
}
.diff-del {
  background: rgba(248, 81, 73, 0.16);
  border-left-color: var(--danger);
}
.diff-context { color: var(--muted); }
.proposal-feedback { display: flex; flex-direction: column; gap: 6px; }
.proposal-actions { display: flex; gap: 8px; }
</style>
