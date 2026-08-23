<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import CComboSelect from '../../../core/ui/CComboSelect.vue'
import type { CComboSelectOption } from '../../../core/ui/CComboSelect.vue'
import { varsSkeletonForStep } from '../lib/vars'
import type { AutomationListItem } from '../scripts/automationsApi'
import type { AutomationFormOptions } from '../scripts/automationsApi'
import type { CreateAutomationRequest, UpdateAutomationRequest } from '../schemas/automation'

const props = defineProps<{
  visible: boolean
  /** Rule đang sửa — null khi tạo mới. */
  editRule: AutomationListItem | null
  eventTypes: string[]
  formOptions: AutomationFormOptions
  saving: boolean
  serverError: string
}>()

const emit = defineEmits<{
  close: []
  submit: [{ mode: 'create' | 'edit'; id?: string; body: CreateAutomationRequest | UpdateAutomationRequest }]
}>()

const { t } = useI18nHelpers()

type TriggerKind = 'timer' | 'event'
type RepeatMode = 'once' | 'interval' | 'cron'
type IntervalUnit = 'minute' | 'hour' | 'day'
type ActionMode = 'create' | 'existing'

interface TriggerRow {
  kind: TriggerKind
  /** timer — datetime-local (local tz). */
  startAt: string
  repeatMode: RepeatMode
  intervalValue: number
  intervalUnit: IntervalUnit
  cronExpr: string
  eventType: string
}

interface ActionRow {
  name: string
  description: string
  mode: ActionMode
  prompt: string
  profileName: string
  runnerId: string
  taskId: string
}

const MAX_TRIGGERS = 5
const MAX_ACTIONS = 10

const form = reactive({
  name: '',
  description: '',
  enabled: true,
  triggers: [] as TriggerRow[],
  actions: [] as ActionRow[],
})

/** Step nào đang mở overview biến (index 1-based). */
const varsOpenFor = ref<number | null>(null)
/** Biến vừa copy — hiện feedback ngắn. */
const copiedVar = ref('')

function newTriggerRow(): TriggerRow {
  return {
    kind: 'timer',
    startAt: '',
    repeatMode: 'once',
    intervalValue: 30,
    intervalUnit: 'minute',
    cronExpr: '',
    eventType: '',
  }
}

function newActionRow(): ActionRow {
  return { name: '', description: '', mode: 'create', prompt: '', profileName: '', runnerId: '', taskId: '' }
}

// ── Chuyển đổi datetime / interval ──────────────────────────────────────────

const UNIT_TO_MS: Record<IntervalUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
}

function everyMsOf(row: TriggerRow): number {
  const value = Math.floor(Number(row.intervalValue))
  if (!Number.isFinite(value) || value < 1) return 0
  return value * UNIT_TO_MS[row.intervalUnit]
}

/** datetime-local (local tz) → ISO cho server. */
function localInputToIso(value: string): string {
  return new Date(value).toISOString()
}

/** ISO → giá trị cho <input type="datetime-local"> (local tz). */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function splitEveryMs(ms: number): { value: number; unit: IntervalUnit } {
  if (ms >= 86_400_000 && ms % 86_400_000 === 0) return { value: ms / 86_400_000, unit: 'day' }
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return { value: ms / 3_600_000, unit: 'hour' }
  return { value: Math.max(1, Math.round(ms / 60_000)), unit: 'minute' }
}

// ── Prefill khi mở dialog ───────────────────────────────────────────────────

watch(
  () => [props.visible, props.editRule] as const,
  ([visible, rule]) => {
    if (!visible) return
    varsOpenFor.value = null
    if (rule) {
      form.name = rule.name
      form.description = rule.description ?? ''
      form.enabled = rule.enabled
      form.triggers = rule.triggers.map((tr): TriggerRow => {
        if (tr.kind === 'timer') {
          const row = newTriggerRow()
          row.kind = 'timer'
          row.startAt = isoToLocalInput(tr.startAt)
          if (tr.repeat.mode === 'interval') {
            const split = splitEveryMs(tr.repeat.everyMs)
            row.repeatMode = 'interval'
            row.intervalValue = split.value
            row.intervalUnit = split.unit
          } else if (tr.repeat.mode === 'cron') {
            row.repeatMode = 'cron'
            row.cronExpr = tr.repeat.expr
          }
          return row
        }
        const row = newTriggerRow()
        row.kind = 'event'
        row.eventType = tr.eventType
        return row
      })
      form.actions = rule.actions.map((a): ActionRow => ({
        name: a.name ?? '',
        description: a.description ?? '',
        mode: a.mode,
        prompt: a.prompt ?? '',
        profileName: a.profileName ?? '',
        runnerId: a.runnerId ?? '',
        taskId: a.taskId ?? '',
      }))
    } else {
      form.name = ''
      form.description = ''
      form.enabled = true
      form.triggers = [newTriggerRow()]
      form.actions = [newActionRow()]
    }
  },
  { immediate: true },
)

// ── Validation ──────────────────────────────────────────────────────────────

const triggerErrors = computed(() =>
  form.triggers.map((row): string => {
    if (row.kind === 'timer') {
      if (!row.startAt) return t('automations.form.timeAtRequired')
      if (Number.isNaN(Date.parse(row.startAt))) return t('automations.form.timeAtInvalid')
      if (row.repeatMode === 'interval' && everyMsOf(row) < 60_000) {
        return t('automations.form.intervalRequired')
      }
      if (row.repeatMode === 'cron') {
        if (!row.cronExpr.trim()) return t('automations.form.cronRequired')
        if (row.cronExpr.trim().split(/\s+/).length !== 5) return t('automations.trigger.cronInvalid')
      }
      return ''
    }
    if (!row.eventType.trim()) return t('automations.form.eventTypeRequired')
    return ''
  }),
)

const actionErrors = computed(() =>
  form.actions.map((row): string => {
    if (row.mode === 'create' && !row.prompt.trim()) return t('automations.action.promptRequired')
    if (row.mode === 'existing') {
      if (!row.taskId.trim()) return t('automations.action.taskIdRequired')
      if (!/^[A-Za-z0-9][\w-]{0,63}$/.test(row.taskId.trim())) return t('automations.action.taskIdInvalid')
    }
    return ''
  }),
)

const validationError = computed(() => {
  if (!form.name.trim()) return t('automations.form.nameRequired')
  if (form.triggers.length === 0) return t('automations.form.triggerRequired')
  if (triggerErrors.value.some((e) => e)) return triggerErrors.value.find((e) => e) || ''
  if (form.actions.length === 0) return t('automations.form.actionRequired')
  if (actionErrors.value.some((e) => e)) return actionErrors.value.find((e) => e) || ''
  return ''
})

// ── Options cho combobox ────────────────────────────────────────────────────

/** Tên thân thiện cho event type: "Job thất bại (job.failed)" — thiếu i18n thì hiện mã. */
function eventLabel(code: string): string {
  const key = `automations.eventNames.${code}`
  const label = t(key)
  return label === key ? code : `${label} (${code})`
}

const eventOptions = computed<CComboSelectOption[]>(() =>
  props.eventTypes.map((code) => ({ value: code, label: eventLabel(code) })),
)

const profileOptions = computed<CComboSelectOption[]>(() =>
  props.formOptions.profiles.map((p) => ({ value: p, label: p })),
)

const runnerOptions = computed<CComboSelectOption[]>(() =>
  props.formOptions.runners.map((r) => ({ value: r.id, label: r.label || r.id })),
)

const taskOptions = computed<CComboSelectOption[]>(() =>
  props.formOptions.tasks.map((id) => ({ value: id, label: id })),
)

// ── Biến tham chiếu ─────────────────────────────────────────────────────────

const hasEventTrigger = computed(() => form.triggers.some((row) => row.kind === 'event' && row.eventType.trim()))

/** Danh sách path biến dùng được tại bước N (1-based) — chips copy được. */
function varPathsFor(stepIndex: number): string[] {
  const paths = ['trigger.kind', 'trigger.type', 'trigger.payload']
  for (let i = 1; i < stepIndex; i++) {
    paths.push(`steps.${i}.taskId`, `steps.${i}.jobId`, `steps.${i}.status`, `steps.${i}.stdout`)
  }
  return paths
}

function varsOverviewFor(stepIndex: number): string {
  return JSON.stringify(varsSkeletonForStep(stepIndex, hasEventTrigger.value), null, 2)
}

/** `steps.1.stdout` → token `{{…}}` — dựng trong script để template parser không nhầm interpolation. */
function varToken(path: string): string {
  return `{{${path}}}`
}

async function copyVar(path: string): Promise<void> {
  const token = `{{${path}}}`
  try {
    await navigator.clipboard.writeText(token)
    copiedVar.value = token
    setTimeout(() => {
      copiedVar.value = ''
    }, 1500)
  } catch {
    copiedVar.value = token
  }
}

// ── Thêm / xoá dòng ─────────────────────────────────────────────────────────

function addTrigger(): void {
  if (form.triggers.length < MAX_TRIGGERS) form.triggers.push(newTriggerRow())
}

function removeTrigger(index: number): void {
  if (form.triggers.length > 1) form.triggers.splice(index, 1)
}

function addAction(): void {
  if (form.actions.length < MAX_ACTIONS) form.actions.push(newActionRow())
}

function removeAction(index: number): void {
  if (form.actions.length > 1) form.actions.splice(index, 1)
}

// ── Submit ──────────────────────────────────────────────────────────────────

function buildTriggers(): CreateAutomationRequest['triggers'] {
  return form.triggers.map((row) => {
    if (row.kind === 'timer') {
      const repeat =
        row.repeatMode === 'interval'
          ? { mode: 'interval' as const, everyMs: everyMsOf(row) }
          : row.repeatMode === 'cron'
            ? { mode: 'cron' as const, expr: row.cronExpr.trim() }
            : { mode: 'once' as const }
      return { kind: 'timer' as const, startAt: localInputToIso(row.startAt), repeat }
    }
    return { kind: 'event' as const, eventType: row.eventType.trim() }
  })
}

function submit(): void {
  if (validationError.value || props.saving) return

  const common = {
    name: form.name.trim(),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    enabled: form.enabled,
    triggers: buildTriggers(),
    actions: form.actions.map((row) => ({
      kind: 'runTask' as const,
      ...(row.name.trim() ? { name: row.name.trim() } : {}),
      ...(row.description.trim() ? { description: row.description.trim() } : {}),
      mode: row.mode,
      ...(row.mode === 'create'
        ? {
            prompt: row.prompt,
            ...(row.profileName.trim() ? { profileName: row.profileName.trim() } : {}),
          }
        : { taskId: row.taskId.trim() }),
      ...(row.runnerId.trim() ? { runnerId: row.runnerId.trim() } : {}),
    })),
  }

  if (props.editRule) {
    emit('submit', { mode: 'edit', id: props.editRule.id, body: common as UpdateAutomationRequest })
  } else {
    emit('submit', { mode: 'create', body: common as CreateAutomationRequest })
  }
}
</script>

<template>
  <div v-if="visible" class="modal-backdrop" @click.self="emit('close')">
    <div class="modal automation-form" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>{{ t(props.editRule ? 'automations.form.editTitle' : 'automations.form.createTitle') }}</h3>
        <button
          type="button"
          class="modal-close"
          :title="t('automations.form.close')"
          :aria-label="t('automations.form.close')"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <div class="modal-body automation-form-body">
        <label class="field">
          <span class="field-label">{{ t('automations.form.name') }}</span>
          <input v-model="form.name" type="text" :placeholder="t('automations.form.namePlaceholder')" />
        </label>

        <label class="field">
          <span class="field-label">{{ t('automations.form.description') }}</span>
          <input v-model="form.description" type="text" />
        </label>

        <!-- ── Triggers: nhiều nguồn, rule chạy khi BẤT KỲ nguồn nào khớp ── -->
        <fieldset class="field-group">
          <legend>{{ t('automations.trigger.header') }}</legend>
          <p class="field-hint">{{ t('automations.trigger.anyMatchHint') }}</p>

          <div v-for="(row, i) in form.triggers" :key="i" class="trigger-row">
            <div class="trigger-row-head">
              <span class="trigger-row-index">{{ i + 1 }}</span>
              <div class="trigger-kind-row">
                <label class="chip-select" :class="{ active: row.kind === 'timer' }">
                  <input v-model="row.kind" type="radio" :value="`timer`" :name="`trigger-kind-${i}`" />
                  {{ t('automations.trigger.timer') }}
                </label>
                <label class="chip-select" :class="{ active: row.kind === 'event' }">
                  <input v-model="row.kind" type="radio" :value="`event`" :name="`trigger-kind-${i}`" />
                  {{ t('automations.trigger.event') }}
                </label>
              </div>
              <button
                type="button"
                class="icon-btn icon-btn-inline danger"
                :title="t('automations.trigger.remove')"
                :aria-label="t('automations.trigger.remove')"
                :disabled="form.triggers.length <= 1"
                @click="removeTrigger(i)"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 4.5h10M6.5 4.5v-1h3v1M4.5 4.5l.5 8h6l.5-8" />
                </svg>
              </button>
            </div>

            <template v-if="row.kind === 'timer'">
              <label class="field">
                <span class="field-label">{{ t('automations.trigger.startAt') }}</span>
                <input v-model="row.startAt" type="datetime-local" />
              </label>
              <div class="trigger-kind-row">
                <label class="chip-select" :class="{ active: row.repeatMode === 'once' }">
                  <input v-model="row.repeatMode" type="radio" value="once" :name="`repeat-${i}`" />
                  {{ t('automations.trigger.once') }}
                </label>
                <label class="chip-select" :class="{ active: row.repeatMode === 'interval' }">
                  <input v-model="row.repeatMode" type="radio" value="interval" :name="`repeat-${i}`" />
                  {{ t('automations.trigger.interval') }}
                </label>
                <label class="chip-select" :class="{ active: row.repeatMode === 'cron' }">
                  <input v-model="row.repeatMode" type="radio" value="cron" :name="`repeat-${i}`" />
                  {{ t('automations.trigger.cron') }}
                </label>
              </div>
              <div v-if="row.repeatMode === 'interval'" class="field interval-row">
                <span class="field-label">{{ t('automations.trigger.intervalEvery') }}</span>
                <span class="interval-inputs">
                  <input v-model.number="row.intervalValue" type="number" min="1" />
                  <select v-model="row.intervalUnit">
                    <option value="minute">{{ t('automations.trigger.intervalMinute') }}</option>
                    <option value="hour">{{ t('automations.trigger.intervalHour') }}</option>
                    <option value="day">{{ t('automations.trigger.intervalDay') }}</option>
                  </select>
                </span>
              </div>
              <label v-else-if="row.repeatMode === 'cron'" class="field">
                <span class="field-label">{{ t('automations.trigger.cronExpr') }}</span>
                <input v-model="row.cronExpr" type="text" placeholder="0 9 * * 1-5" spellcheck="false" />
                <span class="field-hint">{{ t('automations.trigger.cronHint') }}</span>
              </label>
            </template>

            <div v-else class="field">
              <span class="field-label">{{ t('automations.trigger.eventType') }}</span>
              <CComboSelect
                v-model="row.eventType"
                :options="eventOptions"
                creatable
                :aria-label="t('automations.trigger.eventType')"
                :placeholder="t('automations.trigger.eventTypePlaceholder')"
              />
              <span class="field-hint">{{ t('automations.trigger.eventTypeHint') }}</span>
            </div>

            <p v-if="triggerErrors[i]" class="form-error">{{ triggerErrors[i] }}</p>
          </div>

          <button
            type="button"
            class="btn-ghost btn-sm add-row-btn"
            :disabled="form.triggers.length >= MAX_TRIGGERS"
            @click="addTrigger"
          >
            + {{ t('automations.trigger.add') }}
          </button>
        </fieldset>

        <!-- ── Actions: timeline tuần tự, bước sau dùng biến của bước trước ── -->
        <fieldset class="field-group">
          <legend>{{ t('automations.action.header') }}</legend>
          <p class="field-hint">{{ t('automations.action.sequenceHint') }}</p>

          <ol class="action-timeline">
            <li v-for="(row, i) in form.actions" :key="i" class="action-step">
              <div class="step-rail" aria-hidden="true">
                <span class="step-dot">{{ i + 1 }}</span>
                <span v-if="i < form.actions.length - 1" class="step-line" />
              </div>

              <div class="step-body">
                <div class="step-head">
                  <input
                    v-model="row.name"
                    type="text"
                    class="step-name-input"
                    :placeholder="t('automations.action.stepNamePlaceholder', { n: i + 1 })"
                  />
                  <button
                    type="button"
                    class="icon-btn icon-btn-inline"
                    :class="{ active: varsOpenFor === i + 1 }"
                    :title="t('automations.vars.toggle')"
                    :aria-label="t('automations.vars.toggle')"
                    @click="varsOpenFor = varsOpenFor === i + 1 ? null : i + 1"
                  >
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.2v.3" />
                      <circle cx="8" cy="11.6" r="0.5" fill="currentColor" stroke="none" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="icon-btn icon-btn-inline danger"
                    :title="t('automations.action.remove')"
                    :aria-label="t('automations.action.remove')"
                    :disabled="form.actions.length <= 1"
                    @click="removeAction(i)"
                  >
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M3 4.5h10M6.5 4.5v-1h3v1M4.5 4.5l.5 8h6l.5-8" />
                    </svg>
                  </button>
                </div>

                <label class="field">
                  <span class="field-label">{{ t('automations.action.stepDescription') }}</span>
                  <input v-model="row.description" type="text" />
                </label>

                <div class="trigger-kind-row">
                  <label class="chip-select" :class="{ active: row.mode === 'create' }">
                    <input v-model="row.mode" type="radio" value="create" :name="`action-mode-${i}`" />
                    {{ t('automations.action.create') }}
                  </label>
                  <label class="chip-select" :class="{ active: row.mode === 'existing' }">
                    <input v-model="row.mode" type="radio" value="existing" :name="`action-mode-${i}`" />
                    {{ t('automations.action.existing') }}
                  </label>
                </div>

                <label v-if="row.mode === 'create'" class="field">
                  <span class="field-label">{{ t('automations.action.prompt') }}</span>
                  <textarea v-model="row.prompt" rows="4" :placeholder="t('automations.action.promptPlaceholder')" />
                </label>
                <div v-if="row.mode === 'create'" class="field">
                  <span class="field-label">{{ t('automations.action.profileName') }}</span>
                  <CComboSelect
                    v-model="row.profileName"
                    :options="profileOptions"
                    creatable
                    :aria-label="t('automations.action.profileName')"
                    :placeholder="t('automations.action.profileNamePlaceholder')"
                  />
                </div>
                <div v-else class="field">
                  <span class="field-label">{{ t('automations.action.taskId') }}</span>
                  <CComboSelect
                    v-model="row.taskId"
                    :options="taskOptions"
                    creatable
                    :aria-label="t('automations.action.taskId')"
                    :placeholder="t('automations.action.taskIdPlaceholder')"
                  />
                </div>

                <div class="field">
                  <span class="field-label">{{ t('automations.action.runnerId') }}</span>
                  <CComboSelect
                    v-model="row.runnerId"
                    :options="runnerOptions"
                    creatable
                    :aria-label="t('automations.action.runnerId')"
                    :placeholder="t('automations.action.runnerIdPlaceholder')"
                  />
                </div>

                <p v-if="actionErrors[i]" class="form-error">{{ actionErrors[i] }}</p>

                <div v-if="varsOpenFor === i + 1" class="vars-panel">
                  <p class="field-hint">
                    {{ t('automations.vars.hint') }}
                    <span v-if="copiedVar" class="vars-copied">{{ t('automations.vars.copied') }}</span>
                  </p>
                  <div class="vars-chips">
                    <button
                      v-for="path in varPathsFor(i + 1)"
                      :key="path"
                      type="button"
                      class="chip-select vars-chip"
                      :title="varToken(path)"
                      @click="copyVar(path)"
                    >
                      {{ varToken(path) }}
                    </button>
                  </div>
                  <pre class="vars-overview">{{ varsOverviewFor(i + 1) }}</pre>
                </div>
              </div>
            </li>
          </ol>

          <button
            type="button"
            class="btn-ghost btn-sm add-row-btn"
            :disabled="form.actions.length >= MAX_ACTIONS"
            @click="addAction"
          >
            + {{ t('automations.action.add') }}
          </button>
        </fieldset>

        <label class="field checkbox-field">
          <input v-model="form.enabled" type="checkbox" />
          <span>{{ t('automations.form.enabled') }}</span>
        </label>

        <p v-if="validationError" class="form-error">{{ validationError }}</p>
        <p v-else-if="props.serverError" class="form-error">{{ props.serverError }}</p>

        <p class="field-hint pending-hint">{{ t('automations.pending.webhook') }}</p>
      </div>

      <div class="modal-foot">
        <button type="button" class="btn-ghost" @click="emit('close')">
          {{ t('automations.form.cancel') }}
        </button>
        <button
          type="button"
          class="btn-primary"
          :disabled="!!validationError || props.saving"
          @click="submit"
        >
          {{ t(props.saving ? 'automations.form.saving' : 'automations.form.save') }}
        </button>
      </div>
    </div>
  </div>
</template>
