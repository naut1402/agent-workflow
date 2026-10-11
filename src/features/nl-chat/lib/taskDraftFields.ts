import { CreateTaskRequest, TASK_SOURCES } from '../../monitor/schemas/taskCreate'
import type { CSelectOption } from '../../../frontend/ui/CSelect.vue'

/**
 * Mô tả form cho draft task (design.md §4.2.1) — hàm thuần, không Vue, không i18n.
 *
 * Bất biến số 1: **form không bao giờ ghi một key người dùng chưa chạm**. Field
 * `always: true` mà draft chưa có key thì control hiển thị giá trị mặc định của
 * schema, nhưng key vẫn vắng mặt trong draft cho tới khi có thao tác thật —
 * `CreateTaskRequest` có 5 `.default()`, lấy output của nó làm nguồn chân lý là
 * JSON view tự mọc thêm 5 dòng người dùng không gõ.
 */

export type TaskDraftFieldKind = 'text' | 'textarea' | 'select' | 'enum' | 'boolean' | 'stringList'

export interface TaskDraftFieldDef {
  key: string
  kind: TaskDraftFieldKind
  /** i18n suffix: nhãn là `nlChat.draft.field.<labelKey>`. Lib KHÔNG tự dịch. */
  labelKey: string
  /** true = luôn render dù draft chưa có key; false = chỉ render khi draft có key. */
  always: boolean
  /** Giá trị rỗng ⇒ XOÁ HẲN key khỏi draft thay vì ghi '' hay null. */
  clearOnEmpty: boolean
  /** Chỉ cho kind 'enum'. */
  options?: readonly string[]
}

export const TASK_DRAFT_FIELDS: readonly TaskDraftFieldDef[] = [
  { key: 'name', kind: 'text', labelKey: 'name', always: true, clearOnEmpty: true },
  { key: 'prompt', kind: 'textarea', labelKey: 'prompt', always: true, clearOnEmpty: false },
  { key: 'profileName', kind: 'select', labelKey: 'profileName', always: true, clearOnEmpty: true },
  {
    key: 'source',
    kind: 'enum',
    labelKey: 'source',
    always: true,
    clearOnEmpty: false,
    options: TASK_SOURCES,
  },
  { key: 'taskId', kind: 'text', labelKey: 'taskId', always: false, clearOnEmpty: true },
  { key: 'issueUrl', kind: 'text', labelKey: 'issueUrl', always: false, clearOnEmpty: true },
  { key: 'branch', kind: 'text', labelKey: 'branch', always: false, clearOnEmpty: true },
  {
    key: 'parentTaskId',
    kind: 'text',
    labelKey: 'parentTaskId',
    always: false,
    clearOnEmpty: true,
  },
  { key: 'runnerId', kind: 'text', labelKey: 'runnerId', always: false, clearOnEmpty: true },
  {
    key: 'knowledgeInputs',
    kind: 'stringList',
    labelKey: 'knowledgeInputs',
    always: false,
    clearOnEmpty: true,
  },
  { key: 'autoReview', kind: 'boolean', labelKey: 'autoReview', always: true, clearOnEmpty: true },
  { key: 'exportJson', kind: 'boolean', labelKey: 'exportJson', always: true, clearOnEmpty: true },
  { key: 'run', kind: 'boolean', labelKey: 'run', always: true, clearOnEmpty: true },
]

/** Key của CreateTaskRequest mà form KHÔNG dựng control (object lồng) — chỉ sửa ở JSON view. */
export const JSON_ONLY_KEYS = ['pipeline'] as const

const FIELD_KEYS = new Set(TASK_DRAFT_FIELDS.map((f) => f.key))

/** Field nào thực sự render cho draft này: always:true + mọi field draft đang chứa. */
export function visibleFields(draft: Record<string, unknown>): TaskDraftFieldDef[] {
  return TASK_DRAFT_FIELDS.filter(
    (def) => def.always || Object.prototype.hasOwnProperty.call(draft, def.key),
  )
}

/** Giá trị để bind vào control. Không có key ⇒ trả default hiển thị, KHÔNG ghi vào draft. */
export function toFieldValue(
  draft: Record<string, unknown>,
  def: TaskDraftFieldDef,
): string | boolean | string[] {
  const raw = draft[def.key]
  switch (def.kind) {
    case 'boolean':
      return raw === true
    case 'stringList':
      return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
    case 'enum': {
      const options = def.options ?? []
      if (typeof raw === 'string' && options.includes(raw)) return raw
      return options[0] ?? ''
    }
    default:
      return typeof raw === 'string' ? raw : ''
  }
}

/**
 * Trả về draft MỚI (shallow copy). Không bao giờ mutate `draft`.
 *  - value rỗng ('' sau trim, hoặc [], hoặc false) + def.clearOnEmpty ⇒ xoá key
 *  - ngược lại ⇒ ghi giá trị
 * Chuỗi luôn được trim trước khi ghi — `profileName` so khớp CHÍNH XÁC (phân biệt hoa thường).
 */
export function applyFieldChange(
  draft: Record<string, unknown>,
  def: TaskDraftFieldDef,
  value: string | boolean | string[],
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...draft }
  const normalized: string | boolean | string[] =
    typeof value === 'string' ? value.trim() : Array.isArray(value) ? [...value] : value
  const isEmpty =
    typeof normalized === 'string'
      ? normalized === ''
      : Array.isArray(normalized)
        ? normalized.length === 0
        : normalized === false
  if (isEmpty && def.clearOnEmpty) {
    delete next[def.key]
  } else {
    next[def.key] = normalized
  }
  return next
}

/** Key trong draft mà form không dựng được control (JSON_ONLY_KEYS + key lạ ngoài schema). */
export function jsonOnlyKeys(draft: Record<string, unknown>): string[] {
  return Object.keys(draft).filter(
    (k) => (JSON_ONLY_KEYS as readonly string[]).includes(k) || !FIELD_KEYS.has(k),
  )
}

// ── Select pipeline profile ────────────────────────────────────────────────
// `names === null` nghĩa là CHƯA BIẾT, không phải rỗng: `loadProfiles()` bắt lỗi
// và giữ nguyên set cũ, nên bốn trạng thái dưới đây phải phân biệt được với nhau.

export type ProfileSelectState = 'loading' | 'error' | 'empty' | 'ready'

export interface ProfileSelectModel {
  state: ProfileSelectState
  /** Option đầu LUÔN là { value: '', label: <defaultOptionLabel> } — nhãn do component dịch. */
  options: CSelectOption[]
  /** true khi profileName hiện tại không nằm trong catalog (agent bịa tên). */
  unknownCurrent: boolean
}

export function buildProfileOptions(input: {
  names: Set<string> | null
  loading: boolean
  hasError: boolean
  current: string
  defaultOptionLabel: string
  unknownSuffix: string
}): ProfileSelectModel {
  const { names, loading, hasError, current, defaultOptionLabel, unknownSuffix } = input
  const state: ProfileSelectState = hasError
    ? 'error'
    : names === null || loading
      ? 'loading'
      : names.size === 0
        ? 'empty'
        : 'ready'

  const options: CSelectOption[] = [{ value: '', label: defaultOptionLabel }]
  for (const name of names ?? []) options.push({ value: name, label: name })

  // Chỉ kết luận "không có trong catalog" khi đã thật sự biết catalog — ở loading/error
  // thì chưa biết, gắn nhãn lúc đó là nói sai với người dùng.
  const unknownCurrent =
    (state === 'ready' || state === 'empty') &&
    current !== '' &&
    !(names as Set<string>).has(current)
  // Chèn thành option riêng để giá trị agent đề xuất không biến mất vĩnh viễn ngay
  // khi người dùng mở menu chọn thứ khác rồi muốn quay lại.
  if (unknownCurrent) options.push({ value: current, label: `${current} ${unknownSuffix}` })

  return { state, options, unknownCurrent }
}

// ── Lỗi theo field ─────────────────────────────────────────────────────────

export type TaskDraftErrorCode =
  'required' | 'tooLong' | 'tooShort' | 'invalidUrl' | 'invalidPattern' | 'invalid'

export interface TaskDraftFieldError {
  code: TaskDraftErrorCode
  max?: number
  min?: number
}

function classify(issue: { code: string } & Record<string, unknown>): TaskDraftFieldError {
  if (issue.code === 'too_small') {
    const min = Number(issue.minimum)
    return min === 1 ? { code: 'required' } : { code: 'tooShort', min }
  }
  if (issue.code === 'too_big') return { code: 'tooLong', max: Number(issue.maximum) }
  if (issue.code === 'invalid_string') {
    if (issue.validation === 'url') return { code: 'invalidUrl' }
    if (issue.validation === 'regex') return { code: 'invalidPattern' }
    return { code: 'invalid' }
  }
  if (issue.code === 'invalid_type' && issue.received === 'undefined') return { code: 'required' }
  return { code: 'invalid' }
}

/**
 * Lỗi theo key field. Key lồng (vd `knowledgeInputs[2]`) quy về key gốc.
 *
 * 🚫 Tuyệt đối không dùng `result.data`: `safeParse` bơm default cho `source`,
 * `knowledgeInputs`, `autoReview`, `exportJson`, `run` — ở đây chỉ lấy `error`.
 */
export function fieldErrors(draft: Record<string, unknown>): Record<string, TaskDraftFieldError> {
  const result = CreateTaskRequest.safeParse(draft)
  if (result.success) return {}
  const out: Record<string, TaskDraftFieldError> = {}
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '')
    if (!key || out[key]) continue // giữ lỗi ĐẦU TIÊN của mỗi field
    out[key] = classify(issue as unknown as { code: string } & Record<string, unknown>)
  }
  return out
}
