<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { useAutomations } from '../composables/useAutomations'
import type { AutomationListItem } from '../scripts/automationsApi'
import AutomationFormDialog from './AutomationFormDialog.vue'

const props = defineProps<{
  projectId?: string
}>()

const { t } = useI18nHelpers()

const {
  automations,
  eventTypes,
  formOptions,
  loading,
  error,
  actionError,
  historyFor,
  historyRuns,
  historyLoading,
  runningIds,
  load,
  loadEventTypes,
  loadFormOptions,
  create,
  update,
  toggle,
  remove,
  runNow,
  toggleHistory,
  startPolling,
} = useAutomations(() => props.projectId)

const showForm = ref(false)
const editRule = ref<AutomationListItem | null>(null)
const saving = ref(false)

const formServerError = ref('')

function openCreate(): void {
  editRule.value = null
  formServerError.value = ''
  void loadFormOptions()
  showForm.value = true
}

function openEdit(rule: AutomationListItem): void {
  editRule.value = rule
  formServerError.value = ''
  void loadFormOptions()
  showForm.value = true
}

async function onFormSubmit(payload: {
  mode: 'create' | 'edit'
  id?: string
  body: Record<string, unknown>
}): Promise<void> {
  saving.value = true
  const ok =
    payload.mode === 'create'
      ? await create(payload.body as never)
      : await update(payload.id!, payload.body as never)
  saving.value = false
  if (ok) showForm.value = false
  else formServerError.value = actionError.value
}

async function onRunNow(rule: AutomationListItem): Promise<void> {
  await runNow(rule.id)
  // Chuỗi chạy nền — mở history để theo dõi tiến trình từng bước.
  if (historyFor.value !== rule.id) await toggleHistory(rule.id)
}

function onDelete(rule: AutomationListItem): void {
  if (confirm(t('automations.rule.deleteConfirm', { name: rule.name }))) {
    void remove(rule.id)
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

/** Tên thân thiện cho event type: "Job thất bại (job.failed)". */
function eventLabel(code: string): string {
  const key = `automations.eventNames.${code}`
  const label = t(key)
  return label === key ? code : `${label} (${code})`
}

interface TriggerChip {
  key: string
  icon: 'timer' | 'event'
  text: string
}

function triggerChips(rule: AutomationListItem): TriggerChip[] {
  return rule.triggers.map((tr, i): TriggerChip => {
    if (tr.kind === 'timer') {
      if (tr.repeat.mode === 'cron') {
        return { key: `t${i}`, icon: 'timer', text: t('automations.trigger.summaryCron', { expr: tr.repeat.expr }) }
      }
      if (tr.repeat.mode === 'interval') {
        const ms = tr.repeat.everyMs
        const valueUnit =
          ms >= 86_400_000 && ms % 86_400_000 === 0
            ? { value: ms / 86_400_000, unit: t('automations.trigger.intervalDay') }
            : ms >= 3_600_000 && ms % 3_600_000 === 0
              ? { value: ms / 3_600_000, unit: t('automations.trigger.intervalHour') }
              : { value: Math.round(ms / 60_000), unit: t('automations.trigger.intervalMinute') }
        return {
          key: `t${i}`,
          icon: 'timer',
          text: t('automations.trigger.summaryInterval', { value: valueUnit.value, unit: valueUnit.unit }),
        }
      }
      return { key: `t${i}`, icon: 'timer', text: t('automations.trigger.summaryTime', { time: formatTime(tr.startAt) }) }
    }
    return { key: `t${i}`, icon: 'event', text: t('automations.trigger.summaryEvent', { type: eventLabel(tr.eventType) }) }
  })
}

function stepLabel(rule: AutomationListItem, index: number): string {
  const action = rule.actions[index]
  const name = action.name?.trim() || t(action.mode === 'create' ? 'automations.action.create' : 'automations.action.existing')
  const detail = action.mode === 'existing' && action.taskId ? ` · ${action.taskId}` : ''
  return `${name}${detail}`
}

/** Mọi timer một lần đã chạy và không còn lịch nào → hiển thị "one-shot đã chạy". */
function oneShotDone(rule: AutomationListItem): boolean {
  const timers = rule.triggers.filter((tr) => tr.kind === 'timer')
  if (!timers.length) return false
  return rule.nextRunAt === null && timers.every((tr) => tr.kind === 'timer' && tr.repeat.mode === 'once' && rule.state.triggerFired[tr.id])
}

function outcomeKey(rule: AutomationListItem): string {
  if (rule.state.inFlight) return 'automations.outcome.running'
  if (!rule.state.lastOutcome) return ''
  return `automations.outcome.${rule.state.lastOutcome}`
}

const emptyList = computed(() => automations.value.length === 0)

onMounted(() => {
  void load()
  void loadEventTypes()
  startPolling()
})
</script>

<template>
  <section class="automations-panel">
    <header class="panel-head">
      <div>
        <h2>{{ t('automations.title') }}</h2>
        <p class="muted">{{ t('automations.subtitle') }}</p>
      </div>
      <div class="panel-actions">
        <button
          type="button"
          class="icon-btn"
          :title="t('automations.refresh')"
          :aria-label="t('automations.refresh')"
          @click="load()"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M13 8a5 5 0 1 1-1.5-3.5" />
            <path d="M13 3v2.5h-2.5" />
          </svg>
        </button>
        <button type="button" class="btn-primary" @click="openCreate">
          {{ t('automations.create') }}
        </button>
      </div>
    </header>

    <p v-if="error" class="panel-error">{{ t('automations.loadError') }} — {{ error }}</p>

    <div v-if="loading && emptyList" class="panel-empty muted">…</div>

    <div v-else-if="emptyList" class="panel-empty">
      <p>{{ t('automations.empty') }}</p>
      <p class="muted">{{ t('automations.emptyHint') }}</p>
      <p class="muted pending-hint">{{ t('automations.pending.webhook') }}</p>
    </div>

    <ul v-else class="rule-list">
      <li v-for="rule in automations" :key="rule.id" class="rule-card" :class="{ disabled: !rule.enabled }">
        <div class="rule-main">
          <div class="rule-title-row">
            <span class="rule-name">{{ rule.name }}</span>
            <span
              class="rule-status-chip"
              :class="rule.enabled ? 'on' : 'off'"
              :title="t(rule.enabled ? 'automations.rule.enabled' : 'automations.rule.disabled')"
            >
              {{ t(rule.enabled ? 'automations.rule.enabled' : 'automations.rule.disabled') }}
            </span>
            <span v-if="rule.state.inFlight" class="rule-status-chip running">
              {{ t('automations.rule.inFlight') }}
            </span>
          </div>
          <p v-if="rule.description" class="rule-desc muted">{{ rule.description }}</p>

          <div class="rule-triggers">
            <span
              v-for="chip in triggerChips(rule)"
              :key="chip.key"
              class="rule-trigger-chip"
              :title="t('automations.trigger.header')"
            >
              <svg v-if="chip.icon === 'timer'" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="8" cy="8" r="5.5" />
                <path d="M8 5.5V8l1.8 1.2" />
              </svg>
              <svg v-else viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M8.5 2 4 8.5h3L6.5 14 12 7H8.7z" />
              </svg>
              {{ chip.text }}
            </span>
          </div>

          <ol class="rule-steps">
            <li v-for="(_, i) in rule.actions" :key="i" class="rule-step">
              <span class="rule-step-dot">{{ i + 1 }}</span>
              <span>{{ stepLabel(rule, i) }}</span>
            </li>
          </ol>

          <dl class="rule-meta">
            <div class="meta-row">
              <dt>↻</dt>
              <dd>
                <template v-if="rule.state.inFlight">{{ t('automations.rule.inFlight') }}</template>
                <template v-else-if="oneShotDone(rule)">{{ t('automations.rule.oneShotDone') }}</template>
                <template v-else-if="rule.nextRunAt">
                  {{ t('automations.rule.nextRun', { time: formatTime(rule.nextRunAt) }) }}
                </template>
                <template v-else>{{ t('automations.rule.noNextRun') }}</template>
                <span v-if="rule.state.lastRunAt" class="rule-last-run muted">
                  · {{ t('automations.rule.lastRun', { time: formatTime(rule.state.lastRunAt) }) }}
                  <template v-if="outcomeKey(rule)"> ({{ t(outcomeKey(rule)) }})</template>
                </span>
              </dd>
            </div>
          </dl>
        </div>

        <div class="icon-btn-group rule-actions">
          <button
            type="button"
            class="icon-btn icon-btn-inline"
            :class="{ active: rule.enabled }"
            :title="t(rule.enabled ? 'automations.rule.toggleOff' : 'automations.rule.toggleOn')"
            :aria-label="t(rule.enabled ? 'automations.rule.toggleOff' : 'automations.rule.toggleOn')"
            @click="toggle(rule.id, !rule.enabled)"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="8" cy="8" r="6" />
              <path v-if="rule.enabled" d="M8 5v3l2 2" />
              <path v-else d="M8 5v3" />
            </svg>
          </button>
          <button
            type="button"
            class="icon-btn icon-btn-inline"
            :title="t('automations.rule.runNow')"
            :aria-label="t('automations.rule.runNow')"
            :disabled="runningIds.has(rule.id)"
            @click="onRunNow(rule)"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 3.5v9l7-4.5z" />
            </svg>
          </button>
          <button
            type="button"
            class="icon-btn icon-btn-inline"
            :title="t('automations.rule.history')"
            :aria-label="t('automations.rule.history')"
            @click="toggleHistory(rule.id)"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 8a5 5 0 1 0 1.5-3.5" />
              <path d="M3 3v2.5h2.5" />
              <path d="M8 5.5V8l2 1.5" />
            </svg>
          </button>
          <button
            type="button"
            class="icon-btn icon-btn-inline"
            :title="t('automations.rule.edit')"
            :aria-label="t('automations.rule.edit')"
            @click="openEdit(rule)"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M11 2.5l2.5 2.5L6 12.5l-3 .5.5-3z" />
            </svg>
          </button>
          <button
            type="button"
            class="icon-btn icon-btn-inline danger"
            :title="t('automations.rule.delete')"
            :aria-label="t('automations.rule.delete')"
            @click="onDelete(rule)"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 4.5h10M6.5 4.5v-1h3v1M4.5 4.5l.5 8h6l.5-8" />
            </svg>
          </button>
        </div>

        <div v-if="historyFor === rule.id" class="rule-history">
          <h4>{{ t('automations.history.title', { name: rule.name }) }}</h4>
          <p v-if="historyLoading" class="muted">{{ t('automations.history.loading') }}</p>
          <p v-else-if="historyRuns.filter((r) => r.automationId === rule.id).length === 0" class="muted">
            {{ t('automations.history.empty') }}
          </p>
          <table v-else class="history-table">
            <thead>
              <tr>
                <th>{{ t('automations.history.time') }}</th>
                <th>{{ t('automations.history.source') }}</th>
                <th>{{ t('automations.history.outcome') }}</th>
                <th>{{ t('automations.history.detail') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="run in historyRuns.filter((r) => r.automationId === rule.id)" :key="run.runId">
                <td>{{ formatTime(run.startedAt) }}</td>
                <td>{{ t(`automations.runSource.${run.source}`) }}</td>
                <td :class="`outcome-${run.outcome}`">{{ t(`automations.outcome.${run.outcome}`) }}</td>
                <td class="muted">
                  <template v-if="run.error">{{ run.error }}</template>
                  <template v-for="step in run.steps || []" :key="step.index">
                    <span class="history-step"> #{{ step.index }} {{ step.status }}<template v-if="step.taskId"> · {{ step.taskId }}</template></span>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </li>
    </ul>

    <AutomationFormDialog
      :visible="showForm"
      :edit-rule="editRule"
      :event-types="eventTypes"
      :form-options="formOptions"
      :saving="saving"
      :server-error="formServerError"
      @close="showForm = false"
      @submit="onFormSubmit"
    />
  </section>
</template>
