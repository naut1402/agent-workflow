<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import CComboSelect from '../../../core/ui/CComboSelect.vue'
import type { CComboSelectOption } from '../../../core/ui/CComboSelect.vue'
import Icon from '../../../core/ui/Icon.vue'
import { varsSkeletonForStep } from '../lib/vars'
import type { AutomationListItem } from '../scripts/automationsApi'
import type { AutomationFormOptions } from '../scripts/automationsApi'
import type { CreateAutomationRequest, UpdateAutomationRequest } from '../schemas/automation'

const props = defineProps<{
  visible: boolean
  /** Rule đang sửa — null khi tạo mới. */
  editRule: AutomationListItem | null
  eventTypes: string[]
  /** Options của project đang chọn. */
  formOptions: AutomationFormOptions
  /** Options theo project đích của từng bước — khoá là project id. */
  optionsByProject: Record<string, AutomationFormOptions>
  saving: boolean
  serverError: string
}>()

const emit = defineEmits<{
  close: []
  submit: [{ mode: 'create' | 'edit'; id?: string; body: CreateAutomationRequest | UpdateAutomationRequest }]
  /** Bước nào đó trỏ tới project này — nhờ panel nạp options của nó. */
  'request-options': [projectId: string]
}>()

const { t } = useI18nHelpers()

type TriggerKind = 'timer' | 'event'
type RepeatMode = 'once' | 'interval' | 'cron'
type IntervalUnit = 'minute' | 'hour' | 'day'
type ActionMode = 'create' | 'existing'
type ActionKind = 'runTask' | 'httpRequest' | 'runCommand'
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

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
  kind: ActionKind
  name: string
  description: string
  // runTask
  mode: ActionMode
  prompt: string
  profileName: string
  runnerId: string
  taskId: string
  /** Project đích — '' = project đang chọn. */
  projectId: string
  // httpRequest
  method: HttpMethod
  url: string
  /** textarea "Key: Value" mỗi dòng — parse khi submit. */
  headersText: string
  body: string
  // runCommand
  params: string
}

const MAX_TRIGGERS = 5
const MAX_ACTIONS = 10

/** Bản sao FE của `PROJECT_ID_PATTERN` (schemas/automation.ts) — báo lỗi tại chỗ thay vì đợi 400. */
const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

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
  return {
    kind: 'runTask',
    name: '',
    description: '',
    mode: 'create',
    prompt: '',
    profileName: '',
    runnerId: '',
    taskId: '',
    projectId: '',
    method: 'GET',
    url: '',
    headersText: '',
    body: '',
    params: '',
  }
}

function headersToText(headers?: Record<string, string>): string {
  return headers ? Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n') : ''
}

function textToHeaders(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    if (key) out[key] = line.slice(idx + 1).trim()
  }
  return Object.keys(out).length ? out : undefined
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
      form.actions = rule.actions.map((a): ActionRow => {
        const row = newActionRow()
        row.kind = a.kind
        row.name = a.name ?? ''
        row.description = a.description ?? ''
        if (a.kind === 'runTask') {
          row.mode = a.mode
          row.prompt = a.prompt ?? ''
          row.profileName = a.profileName ?? ''
          row.taskId = a.taskId ?? ''
          row.runnerId = a.runnerId ?? ''
          row.projectId = a.projectId ?? ''
        } else if (a.kind === 'httpRequest') {
          row.method = a.method
          row.url = a.url
          row.headersText = headersToText(a.headers)
          row.body = a.body ?? ''
        } else {
          row.runnerId = a.runnerId
          row.params = a.params ?? ''
        }
        return row
      })
    } else {
      form.name = ''
      form.description = ''
      form.enabled = true
      form.triggers = [newTriggerRow()]
      form.actions = []
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
    if (row.kind === 'runTask') {
      if (row.mode === 'create' && !row.prompt.trim()) return t('automations.action.promptRequired')
      if (row.mode === 'existing') {
        if (!row.taskId.trim()) return t('automations.action.taskIdRequired')
        if (!/^[A-Za-z0-9][\w-]{0,63}$/.test(row.taskId.trim())) return t('automations.action.taskIdInvalid')
      }
      // Chặn giá trị rác khi rule được sửa tay ngoài UI rồi mở lại form.
      if (row.projectId.trim() && !PROJECT_ID_RE.test(row.projectId.trim())) {
        return t('automations.action.targetProjectInvalid')
      }
      return ''
    }
    if (row.kind === 'httpRequest') {
      if (!row.url.trim()) return t('automations.action.urlRequired')
      if (!/^https:\/\//i.test(row.url.trim())) return t('automations.action.urlHttpsOnly')
      return ''
    }
    if (!row.runnerId.trim()) return t('automations.action.runnerRequired')
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

/**
 * Options của một bước: theo project đích của chính bước đó, mặc định là
 * project đang chọn. Project đích chưa nạp xong → task/profile/runner rỗng
 * (không mượn của project khác), riêng `projects` là global nên giữ nguyên.
 */
function optionsOf(row: ActionRow): AutomationFormOptions {
  const key = row.projectId.trim()
  if (!key) return props.formOptions
  return (
    props.optionsByProject[key] ?? {
      tasks: [],
      profiles: [],
      runners: [],
      projects: props.formOptions.projects,
    }
  )
}

function profileOptionsOf(row: ActionRow): CComboSelectOption[] {
  return optionsOf(row).profiles.map((p) => ({ value: p, label: p }))
}

function runnerOptionsOf(row: ActionRow): CComboSelectOption[] {
  return optionsOf(row).runners.map((r) => ({ value: r.id, label: r.label || r.id }))
}

function taskOptionsOf(row: ActionRow): CComboSelectOption[] {
  return optionsOf(row).tasks.map((id) => ({ value: id, label: id }))
}

/** Danh sách project lấy từ registry (global) — luôn đọc từ options của project đang chọn. */
const projectOptions = computed<CComboSelectOption[]>(() =>
  props.formOptions.projects.map((p) => ({
    value: p.id,
    label: p.default ? `${p.name} (${t('automations.action.targetProjectDefaultTag')})` : p.name,
  })),
)

/**
 * Đổi project đích: task/profile/runner đã chọn thuộc project cũ nên không còn
 * hợp lệ — xoá thay vì để người dùng lưu một tổ hợp chắc chắn fail lúc chạy.
 */
function onTargetProjectChange(row: ActionRow, value: string): void {
  if (row.projectId === value) return
  row.projectId = value
  row.taskId = ''
  row.profileName = ''
  row.runnerId = ''
}

// Bước nào trỏ project khác thì nhờ panel nạp options của project đó (kể cả khi
// prefill từ rule đang sửa) — panel cache lại nên gọi lặp không tốn request.
watch(
  () => form.actions.map((a) => (a.kind === 'runTask' ? a.projectId.trim() : '')).join('|'),
  () => {
    for (const row of form.actions) {
      if (row.kind === 'runTask' && row.projectId.trim()) emit('request-options', row.projectId.trim())
    }
  },
  { immediate: true },
)

const HTTP_METHODS_UI: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const httpMethodOptions: CComboSelectOption[] = HTTP_METHODS_UI.map((m) => ({ value: m, label: m }))

const commandRunnerOptions = computed<CComboSelectOption[]>(() =>
  props.formOptions.runners
    .filter((r) => !r.family || r.family === 'console-command')
    .map((r) => ({ value: r.id, label: r.label || r.id })),
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
  form.actions.splice(index, 1)
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

function buildActions(): CreateAutomationRequest['actions'] {
  return form.actions.map((row) => {
    const base = {
      ...(row.name.trim() ? { name: row.name.trim() } : {}),
      ...(row.description.trim() ? { description: row.description.trim() } : {}),
    }
    if (row.kind === 'httpRequest') {
      const headers = textToHeaders(row.headersText)
      return {
        kind: 'httpRequest' as const,
        ...base,
        method: row.method,
        url: row.url.trim(),
        ...(headers ? { headers } : {}),
        ...(row.body.trim() ? { body: row.body } : {}),
      }
    }
    if (row.kind === 'runCommand') {
      return {
        kind: 'runCommand' as const,
        ...base,
        runnerId: row.runnerId.trim(),
        ...(row.params.trim() ? { params: row.params } : {}),
      }
    }
    return {
      kind: 'runTask' as const,
      ...base,
      mode: row.mode,
      ...(row.mode === 'create'
        ? {
            prompt: row.prompt,
            ...(row.profileName.trim() ? { profileName: row.profileName.trim() } : {}),
          }
        : { taskId: row.taskId.trim() }),
      ...(row.runnerId.trim() ? { runnerId: row.runnerId.trim() } : {}),
      // Rỗng = không gửi khoá: rule cũ round-trip không mọc field mới.
      ...(row.projectId.trim() ? { projectId: row.projectId.trim() } : {}),
    }
  })
}

function submit(): void {
  if (validationError.value || props.saving) return

  const common = {
    name: form.name.trim(),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    enabled: form.enabled,
    triggers: buildTriggers(),
    actions: buildActions(),
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
                <Icon name="trash" :size="14" />
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
                    @click="removeAction(i)"
                  >
                    <Icon name="trash" :size="14" />
                  </button>
                </div>

                <label class="field">
                  <span class="field-label">{{ t('automations.action.stepDescription') }}</span>
                  <input v-model="row.description" type="text" />
                </label>

                <div class="trigger-kind-row">
                  <label class="chip-select" :class="{ active: row.kind === 'runTask' }">
                    <input v-model="row.kind" type="radio" value="runTask" :name="`action-kind-${i}`" />
                    {{ t('automations.action.runTaskKind') }}
                  </label>
                  <label class="chip-select" :class="{ active: row.kind === 'httpRequest' }">
                    <input v-model="row.kind" type="radio" value="httpRequest" :name="`action-kind-${i}`" />
                    {{ t('automations.action.httpRequest') }}
                  </label>
                  <label class="chip-select" :class="{ active: row.kind === 'runCommand' }">
                    <input v-model="row.kind" type="radio" value="runCommand" :name="`action-kind-${i}`" />
                    {{ t('automations.action.runCommand') }}
                  </label>
                </div>

                <template v-if="row.kind === 'runTask'">
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

                  <!-- Ngoài mọi v-if mode: project đích áp cho cả create lẫn existing. -->
                  <div class="field">
                    <span class="field-label">{{ t('automations.action.targetProject') }}</span>
                    <CComboSelect
                      :model-value="row.projectId"
                      :options="projectOptions"
                      :aria-label="t('automations.action.targetProject')"
                      :placeholder="t('automations.action.targetProjectPlaceholder')"
                      @update:model-value="onTargetProjectChange(row, $event)"
                    />
                    <span class="field-hint">{{ t('automations.action.targetProjectHint') }}</span>
                  </div>

                  <label v-if="row.mode === 'create'" class="field">
                    <span class="field-label">{{ t('automations.action.prompt') }}</span>
                    <textarea v-model="row.prompt" rows="4" :placeholder="t('automations.action.promptPlaceholder')" />
                  </label>
                  <div v-if="row.mode === 'create'" class="field">
                    <span class="field-label">{{ t('automations.action.profileName') }}</span>
                    <CComboSelect
                      v-model="row.profileName"
                      :options="profileOptionsOf(row)"
                      creatable
                      :aria-label="t('automations.action.profileName')"
                      :placeholder="t('automations.action.profileNamePlaceholder')"
                    />
                  </div>
                  <div v-else class="field">
                    <span class="field-label">{{ t('automations.action.taskId') }}</span>
                    <CComboSelect
                      v-model="row.taskId"
                      :options="taskOptionsOf(row)"
                      creatable
                      :aria-label="t('automations.action.taskId')"
                      :placeholder="t('automations.action.taskIdPlaceholder')"
                    />
                  </div>

                  <div class="field">
                    <span class="field-label">{{ t('automations.action.runnerId') }}</span>
                    <CComboSelect
                      v-model="row.runnerId"
                      :options="runnerOptionsOf(row)"
                      creatable
                      :aria-label="t('automations.action.runnerId')"
                      :placeholder="t('automations.action.runnerIdPlaceholder')"
                    />
                  </div>
                </template>

                <template v-else-if="row.kind === 'httpRequest'">
                  <div class="field">
                    <span class="field-label">{{ t('automations.action.method') }}</span>
                    <CComboSelect
                      v-model="row.method"
                      :options="httpMethodOptions"
                      :aria-label="t('automations.action.method')"
                    />
                  </div>
                  <label class="field">
                    <span class="field-label">{{ t('automations.action.url') }}</span>
                    <input v-model="row.url" type="text" :placeholder="t('automations.action.urlPlaceholder')" />
                  </label>
                  <label class="field">
                    <span class="field-label">{{ t('automations.action.headers') }}</span>
                    <textarea v-model="row.headersText" rows="3" :placeholder="t('automations.action.headersPlaceholder')" />
                    <span class="field-hint">{{ t('automations.action.headersHint') }}</span>
                  </label>
                  <label class="field">
                    <span class="field-label">{{ t('automations.action.body') }}</span>
                    <textarea v-model="row.body" rows="4" :placeholder="t('automations.action.bodyPlaceholder')" />
                  </label>
                </template>

                <template v-else>
                  <div class="field">
                    <span class="field-label">{{ t('automations.action.runnerId') }}</span>
                    <CComboSelect
                      v-model="row.runnerId"
                      :options="commandRunnerOptions"
                      creatable
                      :aria-label="t('automations.action.runnerId')"
                      :placeholder="t('automations.action.runnerIdPlaceholder')"
                    />
                  </div>
                  <label class="field">
                    <span class="field-label">{{ t('automations.action.params') }}</span>
                    <textarea v-model="row.params" rows="3" :placeholder="t('automations.action.paramsPlaceholder')" />
                  </label>
                </template>

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

          <p v-if="form.actions.length === 0" class="muted field-hint">{{ t('automations.action.empty') }}</p>

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

<style scoped lang="scss">
.automation-form {
  max-width: 640px;
  width: min(640px, calc(100vw - 32px));

  /* ── [A] từ `styles/common.scss` (đã xoá), phần chỉ form này dùng. PHẢI đứng
     TRƯỚC [B]: `.field` và `.checkbox-field` cùng specificity (0,2,0) và cùng set
     `flex-direction`/`gap`; `.checkbox-field` chỉ thắng nhờ `index.scss` `@use`
     `./common` trước `./AutomationFormDialog`. `.muted` không copy — trùng nguyên
     văn `_shell.scss`. ── */
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 0 10px;

    /* Chỉ style element con TRỰC TIẾP — tránh đè lên input bên trong
       CComboSelect (`.c-combo-input` nằm sâu trong wrapper riêng). */
    > input[type='text'],
    > input[type='number'],
    > input[type='datetime-local'],
    > textarea,
    > select {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font: inherit;
      padding: 6px 8px;
      width: 100%;
      box-sizing: border-box;

      &:focus {
        outline: none;
        border-color: var(--accent);
      }
    }

    > textarea {
      resize: vertical;
      min-height: 72px;
    }

    /* Input lồng trong `.interval-inputs` (cháu của .field, vẫn là control native). */
    .interval-inputs > input,
    .interval-inputs > select {
      background: var(--panel-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font: inherit;
      padding: 6px 8px;
      box-sizing: border-box;

      &:focus {
        outline: none;
        border-color: var(--accent);
      }
    }
  }

  .field-label {
    color: var(--muted);
    font-size: 12px;
  }

  .field-hint {
    color: var(--muted);
    font-size: 11px;
    margin: 2px 0 0;
  }

  .field-group {
    border: 1px solid var(--border);
    border-radius: 8px;
    margin: 0 0 12px;
    padding: 10px;

    legend {
      color: var(--muted);
      font-size: 12px;
      padding: 0 4px;
    }
  }

  .chip-select {
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    cursor: pointer;
    display: inline-flex;
    font-size: 12px;
    gap: 6px;
    padding: 4px 10px;
    transition: all 0.12s ease;

    input {
      display: none;
    }

    &.active {
      border-color: var(--accent);
      color: var(--accent);
      background: rgba(var(--accent-rgb), 0.08);
    }
  }

  .trigger-kind-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }

  .form-error {
    color: var(--danger);
    font-size: 12px;
    margin: 4px 0 8px;
  }

  .pending-hint {
    border-left: 2px solid var(--border);
    padding-left: 8px;
  }

  /* ── [B] từ `styles/AutomationFormDialog.scss` (đã xoá) ── */
  .automation-form-body {
    display: flex;
    flex-direction: column;
    max-height: min(72vh, 720px);
    overflow-y: auto;
  }

  .interval-row .interval-inputs {
    display: flex;
    gap: 8px;

    input,
    select {
      flex: 1;
    }
  }

  .checkbox-field {
    align-items: center;
    flex-direction: row;
    font-size: 13px;
    gap: 8px;

    input {
      margin: 0;
    }
  }

  .modal-foot {
    border-top: 1px solid var(--border);
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 10px 16px;
  }

  /* ── Trigger rows ── */
  .trigger-row {
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 8px;
    padding: 10px;
  }

  .trigger-row-head {
    align-items: center;
    display: flex;
    gap: 8px;
    margin-bottom: 8px;

    .trigger-row-index {
      align-items: center;
      border: 1px solid var(--accent);
      border-radius: 999px;
      color: var(--accent);
      display: inline-flex;
      flex-shrink: 0;
      font-size: 11px;
      height: 18px;
      justify-content: center;
      width: 18px;
    }

    .trigger-kind-row {
      flex: 1;
      margin-bottom: 0;
    }
  }

  .add-row-btn {
    align-self: flex-start;
  }

  /* ── Action timeline ── */
  .action-timeline {
    display: flex;
    flex-direction: column;
    gap: 0;
    list-style: none;
    margin: 4px 0 8px;
    padding: 0;
  }

  .action-step {
    display: flex;
    gap: 10px;
  }

  .step-rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    padding-right: 2px;

    .step-dot {
      align-items: center;
      background: rgba(var(--accent-rgb), 0.12);
      border: 1px solid var(--accent);
      border-radius: 999px;
      color: var(--accent);
      display: inline-flex;
      font-size: 11px;
      height: 22px;
      justify-content: center;
      width: 22px;
    }

    .step-line {
      background: var(--border);
      flex: 1;
      min-height: 14px;
      width: 1px;
    }
  }

  .action-step:last-child .step-line {
    display: none;
  }

  .step-body {
    border: 1px solid var(--border);
    border-radius: 8px;
    flex: 1;
    margin-bottom: 10px;
    padding: 10px;
  }

  .step-head {
    align-items: center;
    display: flex;
    gap: 6px;
    margin-bottom: 8px;

    .step-name-input {
      background: transparent;
      border: none;
      border-bottom: 1px dashed var(--border);
      color: var(--text);
      flex: 1;
      font: inherit;
      font-weight: 600;
      padding: 2px 0;

      &:focus {
        outline: none;
        border-bottom-color: var(--accent);
      }
    }
  }

  /* ── Vars panel ── */
  .vars-panel {
    background: var(--panel-2);
    border: 1px dashed var(--border);
    border-radius: 6px;
    margin-top: 6px;
    padding: 8px;

    .vars-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 6px 0;
    }

    .vars-chip {
      font-family: var(--font-mono, monospace);
      font-size: 11px;
    }

    .vars-copied {
      color: var(--accent);
      margin-left: 6px;
    }

    .vars-overview {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      margin: 6px 0 0;
      max-height: 220px;
      overflow: auto;
      padding: 8px;
      white-space: pre-wrap;
      word-break: break-word;
    }
  }
}
</style>
