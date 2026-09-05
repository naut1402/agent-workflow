<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { useAutomations } from '../composables/useAutomations'
import Icon from '../../../core/ui/Icon.vue'
import type { AutomationListItem, AutomationStepResult } from '../scripts/automationsApi'
import AutomationFormDialog from './AutomationFormDialog.vue'

const props = defineProps<{
  projectId?: string
}>()

const { t } = useI18nHelpers()

const {
  automations,
  eventTypes,
  formOptions,
  optionsByProject,
  loading,
  error,
  actionError,
  runs,
  runsLoading,
  runningIds,
  load,
  loadEventTypes,
  loadFormOptions,
  ensureFormOptions,
  create,
  update,
  toggle,
  remove,
  runNow,
  loadRuns,
  startPolling,
} = useAutomations(() => props.projectId)

const activeTab = ref<'list' | 'history'>('list')
/** '' = tất cả rule. */
const historyRuleFilter = ref('')
const expandedRunId = ref<string | null>(null)

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
  const run = await runNow(rule.id)
  // Chuỗi chạy nền — mở tab lịch sử, lọc theo rule và bung sẵn run vừa tạo để theo dõi từng bước.
  historyRuleFilter.value = rule.id
  expandedRunId.value = run?.runId ?? null
  activeTab.value = 'history'
}

function openHistoryTab(): void {
  activeTab.value = 'history'
  void loadRuns()
}

function onOpenRuleHistory(rule: AutomationListItem): void {
  historyRuleFilter.value = rule.id
  openHistoryTab()
}

const filteredRuns = computed(() =>
  historyRuleFilter.value ? runs.value.filter((run) => run.automationId === historyRuleFilter.value) : runs.value,
)

function ruleNameOf(automationId: string): string {
  return automations.value.find((rule) => rule.id === automationId)?.name ?? automationId
}

function toggleRunExpand(runId: string): void {
  expandedRunId.value = expandedRunId.value === runId ? null : runId
}

/** Tên thân thiện cho outcome/step status, fallback về mã gốc nếu chưa có nhãn (vd job 'cancelled'). */
function outcomeLabel(code: string): string {
  const key = `automations.outcome.${code}`
  const label = t(key)
  return label === key ? code : label
}

interface StepInputEntry {
  key: string
  value: string
}

/** Input đã resolve biến của step — hiển thị lại để người dùng xác nhận đã chạy đúng cấu hình. */
function stepInputEntries(step: AutomationStepResult): StepInputEntry[] {
  if (!step.input) return []
  return Object.entries(step.input).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }))
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
  if (action.kind === 'httpRequest') {
    return `${action.name?.trim() || t('automations.action.httpRequest')} · ${action.method} ${action.url}`
  }
  if (action.kind === 'runCommand') {
    return `${action.name?.trim() || t('automations.action.runCommand')}${action.runnerId ? ` · ${action.runnerId}` : ''}`
  }
  const name = action.name?.trim() || t(action.mode === 'create' ? 'automations.action.create' : 'automations.action.existing')
  const detail = action.mode === 'existing' && action.taskId ? ` · ${action.taskId}` : ''
  // Rule sống ở project này nhưng bước có thể chạy ở project khác — nói rõ để
  // người đọc không nhầm task nằm ở đâu.
  const target = action.projectId ? ` · → ${projectName(action.projectId)}` : ''
  return `${name}${detail}${target}`
}

/** Tên hiển thị của project đích; chưa nạp được registry thì hiện thẳng id. */
function projectName(id: string): string {
  return formOptions.value.projects.find((p) => p.id === id)?.name || id
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
  void loadRuns()
  // `stepLabel` cần danh sách project để đổi id đích sang tên — nạp ngay khi mở
  // panel thay vì đợi người dùng mở dialog.
  void loadFormOptions()
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

    <div class="panel-tabs" role="tablist">
      <button
        type="button"
        class="panel-tab"
        role="tab"
        :class="{ active: activeTab === 'list' }"
        @click="activeTab = 'list'"
      >
        {{ t('automations.tabs.list') }}
      </button>
      <button
        type="button"
        class="panel-tab"
        role="tab"
        :class="{ active: activeTab === 'history' }"
        @click="openHistoryTab"
      >
        {{ t('automations.tabs.history') }}
      </button>
    </div>

    <template v-if="activeTab === 'list'">
      <div v-if="loading && emptyList" class="panel-empty muted">…</div>

      <div v-else-if="emptyList" class="panel-empty">
        <p>{{ t('automations.empty') }}</p>
        <p class="muted">{{ t('automations.emptyHint') }}</p>
        <p class="muted pending-hint">{{ t('automations.pending.webhook') }}</p>
      </div>

      <div v-else class="rule-table-wrap">
        <table class="rule-table">
          <thead>
            <tr>
              <th>{{ t('automations.list.colName') }}</th>
              <th>{{ t('automations.list.colTrigger') }}</th>
              <th>{{ t('automations.list.colSteps') }}</th>
              <th>{{ t('automations.list.colRun') }}</th>
              <th>{{ t('automations.list.colActions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rule in automations" :key="rule.id" class="rule-row" :class="{ disabled: !rule.enabled }">
              <td>
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
              </td>
              <td>
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
              </td>
              <td>
                <ol class="rule-steps">
                  <li v-for="(_, i) in rule.actions" :key="i" class="rule-step">
                    <span class="rule-step-dot">{{ i + 1 }}</span>
                    <span>{{ stepLabel(rule, i) }}</span>
                  </li>
                </ol>
              </td>
              <td>
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
              </td>
              <td class="rule-actions">
                <div class="icon-btn-group">
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
                    @click="onOpenRuleHistory(rule)"
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
                    <Icon name="trash" :size="16" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <div class="history-toolbar">
        <label class="history-filter">
          <span class="muted">{{ t('automations.history.ruleFilter') }}</span>
          <select v-model="historyRuleFilter">
            <option value="">{{ t('automations.history.allRules') }}</option>
            <option v-for="rule in automations" :key="rule.id" :value="rule.id">{{ rule.name }}</option>
          </select>
        </label>
      </div>

      <div class="rule-table-wrap">
        <table class="rule-table">
          <thead>
            <tr>
              <th>{{ t('automations.history.time') }}</th>
              <th>{{ t('automations.history.ruleColumn') }}</th>
              <th>{{ t('automations.history.source') }}</th>
              <th>{{ t('automations.history.outcome') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="runsLoading">
              <td colspan="5" class="muted">{{ t('automations.history.loading') }}</td>
            </tr>
            <template v-else>
              <template v-for="run in filteredRuns" :key="run.runId">
                <tr class="run-row" @click="toggleRunExpand(run.runId)">
                  <td>{{ formatTime(run.startedAt) }}</td>
                  <td>{{ ruleNameOf(run.automationId) }}</td>
                  <td>{{ t(`automations.runSource.${run.source}`) }}</td>
                  <td :class="`outcome-${run.outcome}`">{{ outcomeLabel(run.outcome) }}</td>
                  <td class="run-expand-cell">{{ expandedRunId === run.runId ? '▾' : '▸' }}</td>
                </tr>
                <tr v-if="expandedRunId === run.runId" class="run-detail-row">
                  <td colspan="5">
                    <p v-if="run.error" class="outcome-failed">{{ run.error }}</p>
                    <p v-if="!run.steps || run.steps.length === 0" class="muted">{{ t('automations.history.empty') }}</p>
                    <ol v-else class="run-steps-detail">
                      <li v-for="step in run.steps" :key="step.index" class="run-step-detail">
                        <div class="step-detail-head">
                          <span class="rule-step-dot">{{ step.index }}</span>
                          <span v-if="step.name">{{ step.name }}</span>
                          <span :class="`outcome-${step.status}`">{{ outcomeLabel(step.status) }}</span>
                        </div>
                        <div class="step-detail-body">
                          <div class="step-detail-col">
                            <h5>{{ t('automations.history.stepInput') }}</h5>
                            <dl v-if="stepInputEntries(step).length">
                              <template v-for="entry in stepInputEntries(step)" :key="entry.key">
                                <dt>{{ entry.key }}</dt>
                                <dd>{{ entry.value }}</dd>
                              </template>
                            </dl>
                            <p v-else class="muted">{{ t('automations.history.noInput') }}</p>
                          </div>
                          <div class="step-detail-col">
                            <h5>{{ t('automations.history.stepResult') }}</h5>
                            <p v-if="step.error" class="outcome-failed">{{ step.error }}</p>
                            <pre v-if="step.stdout">{{ step.stdout }}</pre>
                            <p v-if="!step.error && !step.stdout" class="muted">{{ t('automations.history.noResult') }}</p>
                            <p v-if="step.taskId" class="muted">taskId: {{ step.taskId }}</p>
                          </div>
                        </div>
                      </li>
                    </ol>
                  </td>
                </tr>
              </template>
              <tr v-if="filteredRuns.length === 0">
                <td colspan="5" class="muted">{{ t('automations.history.empty') }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </template>

    <AutomationFormDialog
      :visible="showForm"
      :edit-rule="editRule"
      :event-types="eventTypes"
      :form-options="formOptions"
      :options-by-project="optionsByProject"
      :saving="saving"
      :server-error="formServerError"
      @close="showForm = false"
      @submit="onFormSubmit"
      @request-options="ensureFormOptions"
    />
  </section>
</template>

<style scoped lang="scss">
.automations-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  padding: 16px;

  /* `.pending-hint`: từ `styles/common.scss` (đã xoá) — class duy nhất ở đó mà
     panel này render (`class="muted pending-hint"`); `.muted` vẫn do `_shell.scss` lo. */
  .pending-hint {
    border-left: 2px solid var(--border);
    padding-left: 8px;
  }

  .panel-head {
    align-items: center;
    display: flex;
    justify-content: space-between;
    gap: 12px;

    h2 {
      font-size: 16px;
      margin: 0;
    }

    p {
      font-size: 12px;
      margin: 2px 0 0;
    }
  }

  .panel-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .panel-error {
    color: var(--danger);
    font-size: 13px;
    margin: 0;
  }

  .panel-empty {
    align-items: center;
    border: 1px dashed var(--border);
    border-radius: 8px;
    color: var(--text);
    display: flex;
    flex-direction: column;
    gap: 4px;
    justify-content: center;
    min-height: 200px;
    text-align: center;
  }

  .rule-table-wrap {
    flex: 1;
    min-height: 0; // bắt buộc để flex-child scroll được thay vì tràn cha
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .rule-table {
    border-collapse: collapse;
    width: 100%;

    thead th {
      position: sticky;
      top: 0;
      background: var(--panel);
      text-align: left;
      font-weight: 500;
      color: var(--muted);
      font-size: 12px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      z-index: 1;
    }

    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }

    .rule-row.disabled {
      opacity: 0.6;
    }
  }

  .rule-title-row {
    align-items: center;
    display: flex;
    gap: 8px;

    .rule-name {
      font-weight: 600;
    }
  }

  .rule-status-chip {
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 11px;
    padding: 1px 8px;

    &.on {
      border-color: var(--accent);
      color: var(--accent);
    }

    &.off {
      color: var(--muted);
    }

    &.running {
      border-color: var(--accent);
      color: var(--accent);
      animation: automation-pulse 1.2s ease-in-out infinite;
    }
  }

  .rule-desc {
    font-size: 12px;
    margin: 2px 0 0;
  }

  .rule-triggers {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .rule-trigger-chip {
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text);
    display: inline-flex;
    font-size: 11px;
    gap: 5px;
    max-width: 100%;
    overflow: hidden;
    padding: 2px 9px;
    text-overflow: ellipsis;
    white-space: nowrap;

    svg {
      color: var(--muted);
      flex-shrink: 0;
    }
  }

  /* Mini timeline các bước action trên card. */
  .rule-steps {
    display: flex;
    flex-direction: column;
    gap: 3px;
    list-style: none;
    margin: 8px 0 0;
    padding: 0;

    .rule-step {
      align-items: center;
      display: flex;
      font-size: 12px;
      gap: 8px;
    }

    .rule-step-dot {
      align-items: center;
      border: 1px solid var(--accent);
      border-radius: 999px;
      color: var(--accent);
      display: inline-flex;
      flex-shrink: 0;
      font-size: 10px;
      height: 16px;
      justify-content: center;
      width: 16px;
    }
  }

  .rule-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 8px 0 0;

    .meta-row {
      display: flex;
      gap: 8px;
      font-size: 12px;

      dt {
        color: var(--muted);
        min-width: 20px;
      }

      dd {
        margin: 0;
      }
    }
  }

  .rule-last-run {
    font-size: 11px;
  }

  .rule-actions {
    white-space: nowrap;
  }

  .outcome-succeeded { color: var(--accent); }
  .outcome-failed { color: var(--danger); }
  .outcome-skipped,
  .outcome-running { color: var(--muted); }

  .panel-tabs {
    display: flex;
    gap: 4px;
  }

  .panel-tab {
    border: none;
    background: transparent;
    color: var(--muted);
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-size: 13px;

    &.active {
      background: rgba(var(--accent-rgb), 0.15);
      color: var(--accent);
    }
  }

  .history-toolbar {
    display: flex;
    justify-content: flex-end;
  }

  .history-filter {
    align-items: center;
    display: flex;
    font-size: 12px;
    gap: 8px;
  }

  .run-row {
    cursor: pointer;

    &:hover {
      background: var(--panel-2, transparent);
    }
  }

  .run-expand-cell {
    color: var(--muted);
    text-align: center;
    width: 24px;
  }

  .run-detail-row td {
    background: var(--bg);
  }

  .run-steps-detail {
    display: flex;
    flex-direction: column;
    gap: 10px;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .run-step-detail {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
  }

  .step-detail-head {
    align-items: center;
    display: flex;
    font-size: 12px;
    font-weight: 600;
    gap: 8px;
    margin-bottom: 6px;
  }

  .step-detail-body {
    display: grid;
    gap: 12px;
    grid-template-columns: 1fr 1fr;
  }

  .step-detail-col {
    font-size: 12px;
    min-width: 0;

    h5 {
      color: var(--muted);
      font-size: 11px;
      font-weight: 500;
      margin: 0 0 4px;
      text-transform: uppercase;
    }

    dl {
      margin: 0;
    }

    dt {
      color: var(--muted);
      font-size: 11px;

      &::after {
        content: ':';
      }
    }

    dd {
      margin: 0 0 6px;
      overflow-wrap: anywhere;
    }

    pre {
      background: var(--panel-2, transparent);
      border-radius: 6px;
      margin: 0;
      max-height: 220px;
      overflow: auto;
      padding: 6px 8px;
      white-space: pre-wrap;
      word-break: break-word;
    }
  }
}

@keyframes automation-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
</style>
