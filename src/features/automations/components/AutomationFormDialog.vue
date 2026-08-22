<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import type {
  AutomationListItem,
} from '../scripts/automationsApi'
import type {
  AutomationTrigger,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from '../schemas/automation'

const props = defineProps<{
  visible: boolean
  /** Rule đang sửa — null khi tạo mới. */
  editRule: AutomationListItem | null
  eventTypes: string[]
  saving: boolean
  serverError: string
}>()

const emit = defineEmits<{
  close: []
  submit: [{ mode: 'create' | 'edit'; id?: string; body: CreateAutomationRequest | UpdateAutomationRequest }]
}>()

const { t } = useI18nHelpers()

type TriggerKind = 'time' | 'interval' | 'cron' | 'event'
type IntervalUnit = 'minute' | 'hour' | 'day'
type ActionMode = 'create' | 'existing'

const form = reactive({
  name: '',
  description: '',
  enabled: true,
  triggerKind: 'time' as TriggerKind,
  timeAt: '',
  intervalValue: 30,
  intervalUnit: 'minute' as IntervalUnit,
  cronExpr: '',
  eventType: '',
  actionMode: 'create' as ActionMode,
  prompt: '',
  profileName: '',
  runnerId: '',
  taskId: '',
})

const validationError = computed(() => {
  if (!form.name.trim()) return t('automations.form.nameRequired')
  if (form.triggerKind === 'time') {
    if (!form.timeAt) return t('automations.form.timeAtRequired')
    if (Number.isNaN(Date.parse(form.timeAt))) return t('automations.form.timeAtInvalid')
  }
  if (form.triggerKind === 'interval' && everyMs.value < 60_000) {
    return t('automations.form.intervalRequired')
  }
  if (form.triggerKind === 'cron') {
    if (!form.cronExpr.trim()) return t('automations.form.cronRequired')
    if (form.cronExpr.trim().split(/\s+/).length !== 5) return t('automations.trigger.cronInvalid')
  }
  if (form.triggerKind === 'event' && !form.eventType.trim()) {
    return t('automations.form.eventTypeRequired')
  }
  if (form.actionMode === 'create' && !form.prompt.trim()) return t('automations.action.promptRequired')
  if (form.actionMode === 'existing') {
    if (!form.taskId.trim()) return t('automations.action.taskIdRequired')
    if (!/^[A-Za-z0-9][\w-]{0,63}$/.test(form.taskId.trim())) return t('automations.action.taskIdInvalid')
  }
  return ''
})

const UNIT_TO_MS: Record<IntervalUnit, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
}

const everyMs = computed(() => {
  const value = Math.floor(Number(form.intervalValue))
  if (!Number.isFinite(value) || value < 1) return 0
  return value * UNIT_TO_MS[form.intervalUnit]
})

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

watch(
  () => [props.visible, props.editRule] as const,
  ([visible, rule]) => {
    if (!visible) return
    if (rule) {
      form.name = rule.name
      form.description = rule.description ?? ''
      form.enabled = rule.enabled
      form.triggerKind = rule.trigger.kind
      if (rule.trigger.kind === 'time') form.timeAt = isoToLocalInput(rule.trigger.at)
      if (rule.trigger.kind === 'interval') {
        const split = splitEveryMs(rule.trigger.everyMs)
        form.intervalValue = split.value
        form.intervalUnit = split.unit
      }
      if (rule.trigger.kind === 'cron') form.cronExpr = rule.trigger.cron
      if (rule.trigger.kind === 'event') form.eventType = rule.trigger.eventType
      form.actionMode = rule.action.mode
      form.prompt = rule.action.prompt ?? ''
      form.profileName = rule.action.profileName ?? ''
      form.runnerId = rule.action.runnerId ?? ''
      form.taskId = rule.action.taskId ?? ''
    } else {
      form.name = ''
      form.description = ''
      form.enabled = true
      form.triggerKind = 'time'
      form.timeAt = ''
      form.intervalValue = 30
      form.intervalUnit = 'minute'
      form.cronExpr = ''
      form.eventType = ''
      form.actionMode = 'create'
      form.prompt = ''
      form.profileName = ''
      form.runnerId = ''
      form.taskId = ''
    }
  },
  { immediate: true },
)

function buildTrigger(): AutomationTrigger | null {
  switch (form.triggerKind) {
    case 'time':
      return { kind: 'time', at: localInputToIso(form.timeAt) }
    case 'interval':
      return { kind: 'interval', everyMs: everyMs.value }
    case 'cron':
      return { kind: 'cron', cron: form.cronExpr.trim() }
    case 'event':
      return { kind: 'event', eventType: form.eventType.trim() }
    default:
      return null
  }
}

function submit(): void {
  if (validationError.value || props.saving) return
  const trigger = buildTrigger()
  if (!trigger) return

  const common = {
    name: form.name.trim(),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    enabled: form.enabled,
    trigger,
    action: {
      kind: 'runTask' as const,
      mode: form.actionMode,
      ...(form.actionMode === 'create'
        ? {
            prompt: form.prompt,
            ...(form.profileName.trim() ? { profileName: form.profileName.trim() } : {}),
          }
        : { taskId: form.taskId.trim() }),
      ...(form.runnerId.trim() ? { runnerId: form.runnerId.trim() } : {}),
    },
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

        <fieldset class="field-group">
          <legend>{{ t('automations.trigger.kind') }}</legend>
          <div class="trigger-kind-row">
            <label
              v-for="kind in (['time', 'interval', 'cron', 'event'] as const)"
              :key="kind"
              class="chip-select"
              :class="{ active: form.triggerKind === kind }"
            >
              <input v-model="form.triggerKind" type="radio" :value="kind" />
              {{ t(`automations.trigger.${kind}`) }}
            </label>
          </div>

          <label v-if="form.triggerKind === 'time'" class="field">
            <span class="field-label">{{ t('automations.trigger.timeAt') }}</span>
            <input v-model="form.timeAt" type="datetime-local" />
          </label>

          <div v-else-if="form.triggerKind === 'interval'" class="field interval-row">
            <span class="field-label">{{ t('automations.trigger.intervalEvery') }}</span>
            <span class="interval-inputs">
              <input v-model.number="form.intervalValue" type="number" min="1" />
              <select v-model="form.intervalUnit">
                <option value="minute">{{ t('automations.trigger.intervalMinute') }}</option>
                <option value="hour">{{ t('automations.trigger.intervalHour') }}</option>
                <option value="day">{{ t('automations.trigger.intervalDay') }}</option>
              </select>
            </span>
          </div>

          <label v-else-if="form.triggerKind === 'cron'" class="field">
            <span class="field-label">{{ t('automations.trigger.cronExpr') }}</span>
            <input v-model="form.cronExpr" type="text" placeholder="0 9 * * 1-5" spellcheck="false" />
            <span class="field-hint">{{ t('automations.trigger.cronHint') }}</span>
          </label>

          <label v-else class="field">
            <span class="field-label">{{ t('automations.trigger.eventType') }}</span>
            <input
              v-model="form.eventType"
              type="text"
              list="automation-event-types"
              placeholder="job.failed"
              spellcheck="false"
            />
            <datalist id="automation-event-types">
              <option v-for="type in props.eventTypes" :key="type" :value="type" />
            </datalist>
            <span class="field-hint">{{ t('automations.trigger.eventTypeHint') }}</span>
          </label>
        </fieldset>

        <fieldset class="field-group">
          <legend>{{ t('automations.action.header') }}</legend>
          <div class="trigger-kind-row">
            <label class="chip-select" :class="{ active: form.actionMode === 'create' }">
              <input v-model="form.actionMode" type="radio" value="create" />
              {{ t('automations.action.create') }}
            </label>
            <label class="chip-select" :class="{ active: form.actionMode === 'existing' }">
              <input v-model="form.actionMode" type="radio" value="existing" />
              {{ t('automations.action.existing') }}
            </label>
          </div>

          <label v-if="form.actionMode === 'create'" class="field">
            <span class="field-label">{{ t('automations.action.prompt') }}</span>
            <textarea v-model="form.prompt" rows="4" :placeholder="t('automations.action.promptPlaceholder')" />
          </label>
          <label v-if="form.actionMode === 'create'" class="field">
            <span class="field-label">{{ t('automations.action.profileName') }}</span>
            <input
              v-model="form.profileName"
              type="text"
              :placeholder="t('automations.action.profileNamePlaceholder')"
              spellcheck="false"
            />
          </label>
          <label v-else class="field">
            <span class="field-label">{{ t('automations.action.taskId') }}</span>
            <input
              v-model="form.taskId"
              type="text"
              :placeholder="t('automations.action.taskIdPlaceholder')"
              spellcheck="false"
            />
          </label>

          <label class="field">
            <span class="field-label">{{ t('automations.action.runnerId') }}</span>
            <input
              v-model="form.runnerId"
              type="text"
              :placeholder="t('automations.action.runnerIdPlaceholder')"
              spellcheck="false"
            />
          </label>
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
