<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
import { onMounted, ref } from 'vue'
import { useArtifactProposal } from '../composables/useArtifactProposal'

// Review UI for a require_approval quick action: shows the proposed diff
// (before = real file, after = agent's edit in the scratch copy) and lets the
// user approve (apply to the real file), discard (throw the scratch away), or
// send follow-up feedback into the same CLI session. Opened by ArtifactPanel
// when a run settles at `awaiting_approval`.

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
  <Teleport to="body">
    <div class="proposal-overlay" @click.self="emit('close')">
      <div class="proposal-modal" role="dialog" aria-modal="true">
        <header class="proposal-head">
          <span class="proposal-title">
            {{ t('monitor.proposal.reviewTitle') }} <code>{{ proposal.artifactName.value || artifactName }}</code>
          </span>
          <button type="button" class="btn-link" :disabled="proposal.busy.value" @click="emit('close')">✕</button>
        </header>

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

        <footer class="proposal-actions">
          <button type="button" class="btn-primary" :disabled="proposal.busy.value || proposal.loading.value" @click="onApprove">
            {{ t('monitor.proposal.approve') }}
          </button>
          <button type="button" class="btn-ghost btn-danger" :disabled="proposal.busy.value" @click="onDiscard">
            {{ t('monitor.proposal.discard') }}
          </button>
          <button type="button" class="btn-ghost" :disabled="proposal.busy.value" @click="emit('close')">{{ t('monitor.proposal.close') }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.proposal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}
.proposal-modal {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  width: min(860px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.proposal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.proposal-title { font-size: 14px; font-weight: 600; }
.proposal-error {
  margin: 0;
  color: var(--danger);
  font-size: 13px;
}
.proposal-status { margin: 0; color: var(--muted); font-size: 13px; }
.proposal-muted { color: var(--muted); font-size: 13px; }
.proposal-body {
  flex: 1 1 auto;
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
