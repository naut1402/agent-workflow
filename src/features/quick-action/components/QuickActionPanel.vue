<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { fetchRunners, fetchCatalog } from '../../../api'
import { useQuickActionCatalog, type QuickActionDraft } from '../composables/useQuickActionCatalog'

// CRUD panel for the artifact-actions catalog (Correction B / F0005): create,
// edit, delete a "quick action" — the prompt/agent/attach-point/runner binding
// that shows up as a button on the artifact title toolbar and/or the
// text-selection toolbar in Monitor's ArtifactPanel. The editor is a resizable
// modal dialog; the action id is derived from the label (not entered).

const props = defineProps<{
  projectId?: string | null
}>()

const ATTACH_OPTIONS = [
  { value: 'artifact-title', label: 'Artifact title' },
  { value: 'artifact-selection', label: 'Text selection' },
]

const catalog = useQuickActionCatalog({ getProjectId: () => props.projectId ?? null })
const runners = ref<Array<{ id: string; name: string }>>([])
const agents = ref<Array<{ id: string; name?: string; description?: string }>>([])
const agentIds = computed(() => new Set(agents.value.map((a) => a.id)))

const showForm = ref(false)
const editingId = ref<string | null>(null)
const formError = ref('')
const message = ref('')
const showPromptHelp = ref(false)

// Danh sách placeholder hỗ trợ trong `prompt_template` — khớp với
// `substitutePrompt()` (server/artifactActions/index.ts). `{{selection}}` và
// `{{selection_lines}}` chỉ có giá trị khi action được chạy từ selection
// toolbar (tức action có gắn attach point "Text selection" và người dùng bôi
// đen một đoạn trong artifact rồi bấm nút) — chạy từ title toolbar thì hai
// placeholder này luôn rỗng.
const PROMPT_PLACEHOLDERS: Array<{ token: string; desc: string; selectionOnly?: boolean }> = [
  { token: '{{artifact_name}}', desc: 'Tên file artifact đầy đủ, ví dụ "design.md".' },
  { token: '{{artifact_base}}', desc: 'Tên file artifact không có phần mở rộng, ví dụ "design".' },
  {
    token: '{{selection}}',
    desc: 'Đoạn văn bản người dùng đã bôi đen trong artifact viewer.',
    selectionOnly: true,
  },
  {
    token: '{{selection_lines}}',
    desc: 'Dòng (trong file gốc) tương ứng vùng đã chọn, dạng "12" hoặc "12-15".',
    selectionOnly: true,
  },
]

// Floating help popover for the prompt_template placeholders. Rendered as an
// absolutely-positioned overlay (does NOT push the fields below it down) that
// closes on a second click of ❓, a click anywhere outside it, or Esc.
const promptHelpRef = ref<HTMLElement | null>(null)
const helpBtnRef = ref<HTMLElement | null>(null)

function onDocClick(e: MouseEvent) {
  const t = e.target as Node
  if (promptHelpRef.value?.contains(t) || helpBtnRef.value?.contains(t)) return
  closePromptHelp()
}
function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape') closePromptHelp()
}
function openPromptHelp() {
  showPromptHelp.value = true
  // Defer binding so the click that opened the popover doesn't immediately
  // close it via the capture-phase outside-click handler.
  nextTick(() => {
    document.addEventListener('click', onDocClick, true)
    document.addEventListener('keydown', onDocKey)
  })
}
function closePromptHelp() {
  showPromptHelp.value = false
  document.removeEventListener('click', onDocClick, true)
  document.removeEventListener('keydown', onDocKey)
}
function togglePromptHelp() {
  if (showPromptHelp.value) closePromptHelp()
  else openPromptHelp()
}

onBeforeUnmount(closePromptHelp)

function emptyDraft(): QuickActionDraft {
  return {
    id: '',
    label: '',
    artifact_patterns: [],
    agent_ref: '',
    prompt_template: '',
    produces: [],
    confirm: false,
    attach_points: ['artifact-title'],
    runner_id: undefined,
    require_approval: false,
  }
}

const draft = ref<QuickActionDraft>(emptyDraft())
const patternsText = ref('')

// Derive a stable action id from the label (the id field is no longer entered).
// Strip diacritics/emoji/punctuation to an ascii kebab slug; ensure uniqueness
// against the existing catalog. Only used when creating — an edited action
// keeps its original id so its identity is stable.
function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
function deriveId(label: string): string {
  const base = slugify(label) || 'quick-action'
  const taken = new Set(catalog.actions.value.map((a) => a.id))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

async function loadRunnerOptions() {
  try {
    const res = await fetchRunners()
    runners.value = Array.isArray(res?.runners) ? res.runners : []
  } catch {
    runners.value = []
  }
}

async function loadAgentOptions() {
  try {
    const res = await fetchCatalog()
    agents.value = Array.isArray(res?.agents)
      ? res.agents.filter((a: any) => a && typeof a.id === 'string')
      : []
  } catch {
    agents.value = []
  }
}

onMounted(async () => {
  await Promise.all([catalog.load(), loadRunnerOptions(), loadAgentOptions()])
})

function openNew() {
  editingId.value = null
  draft.value = emptyDraft()
  patternsText.value = ''
  formError.value = ''
  message.value = ''
  closePromptHelp()
  showForm.value = true
}

function openEdit(a: QuickActionDraft) {
  editingId.value = a.id
  draft.value = {
    ...a,
    produces: [...(a.produces ?? [])],
    attach_points: [...(a.attach_points ?? ['artifact-title'])],
    require_approval: a.require_approval ?? false,
  }
  patternsText.value = (a.artifact_patterns ?? []).join(', ')
  formError.value = ''
  message.value = ''
  closePromptHelp()
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  editingId.value = null
  closePromptHelp()
}

function toggleAttach(value: string, checked: boolean) {
  const set = new Set(draft.value.attach_points)
  if (checked) set.add(value)
  else set.delete(value)
  draft.value.attach_points = Array.from(set)
}

async function saveForm() {
  formError.value = ''
  if (!draft.value.label.trim()) {
    formError.value = 'label không được để trống'
    return
  }
  draft.value.artifact_patterns = patternsText.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // id is derived from the label (create) or kept as-is (edit).
  draft.value.id = editingId.value ?? deriveId(draft.value.label)

  const result = catalog.upsert({ ...draft.value }, editingId.value)
  if ('error' in result) {
    formError.value = result.error
    return
  }
  const ok = await catalog.persist(catalog.actions.value)
  if (!ok) {
    formError.value = catalog.error.value || 'Lưu thất bại'
    return
  }
  message.value = `Đã lưu "${draft.value.label}"`
  closeForm()
}

async function removeAction(a: QuickActionDraft) {
  if (typeof window !== 'undefined' && !window.confirm(`Xóa quick action "${a.label}"?`)) return
  catalog.remove(a.id)
  const ok = await catalog.persist(catalog.actions.value)
  if (ok) message.value = `Đã xóa "${a.label}"`
}
</script>

<template>
  <div class="quick-action-panel">
    <header class="qa-panel-head">
      <h2>Quick Action</h2>
      <p class="muted">
        CRUD các quick action gắn vào artifact viewer (title toolbar / selection toolbar).
      </p>
    </header>

    <div v-if="catalog.error.value" class="err">{{ catalog.error.value }}</div>
    <p v-if="message" class="ok-msg">{{ message }}</p>

    <div class="qa-toolbar">
      <button type="button" class="btn-primary btn-sm" @click="openNew">+ New</button>
    </div>

    <table class="qa-table">
      <thead>
        <tr>
          <th>label</th>
          <th>patterns</th>
          <th>agent</th>
          <th>attach</th>
          <th>runner</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!catalog.actions.value.length">
          <td colspan="6" class="muted qa-empty">Chưa có quick action nào.</td>
        </tr>
        <tr v-for="a in catalog.actions.value" :key="a.id">
          <td>{{ a.label }}</td>
          <td class="muted">{{ (a.artifact_patterns ?? []).join(', ') }}</td>
          <td class="muted">{{ a.agent_ref || '(prompt trực tiếp)' }}</td>
          <td>
            <span v-for="ap in a.attach_points ?? ['artifact-title']" :key="ap" class="chip chip-xs">{{ ap }}</span>
            <span v-if="a.require_approval" class="chip chip-xs chip-approval" title="Yêu cầu phê duyệt trước khi ghi">✓ phê duyệt</span>
          </td>
          <td class="muted">{{ a.runner_id || '(default)' }}</td>
          <td class="qa-row-actions">
            <button type="button" class="btn-ghost btn-sm" @click="openEdit(a)">Sửa</button>
            <button type="button" class="btn-ghost btn-sm btn-danger" @click="removeAction(a)">Xóa</button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="showForm" class="qa-modal-overlay" @click.self="closeForm">
      <div class="qa-form" role="dialog" aria-modal="true">
        <div class="qa-form-head">
          <h3>{{ editingId ? `Sửa "${draft.label || editingId}"` : 'Quick action mới' }}</h3>
          <button type="button" class="btn-link qa-form-close" aria-label="Đóng" @click="closeForm">✕</button>
        </div>
        <p v-if="formError" class="err">{{ formError }}</p>

        <div class="qa-form-body">
          <label class="cfg-label">
            label
            <input v-model="draft.label" class="cfg-input" placeholder="✨ Cải thiện tài liệu" />
          </label>
          <label class="cfg-label">
            artifact_patterns (phân tách bằng dấu phẩy)
            <input v-model="patternsText" class="cfg-input" placeholder="design.md, investigate.md, *.md" />
          </label>
          <label class="cfg-label">
            agent (tuỳ chọn — để "prompt trực tiếp" thì chạy thẳng prompt_template, không gắn agent)
            <select v-model="draft.agent_ref" class="cfg-input">
              <option value="">(prompt trực tiếp — không gắn agent)</option>
              <option
                v-if="draft.agent_ref && !agentIds.has(draft.agent_ref)"
                :value="draft.agent_ref"
              >{{ draft.agent_ref }} (hiện tại)</option>
              <option v-for="a in agents" :key="a.id" :value="a.id">
                {{ a.name ? `${a.name} — ${a.id}` : a.id }}
              </option>
            </select>
          </label>
          <label class="cfg-label">
            <span class="qa-prompt-label-row">
              prompt_template
              <button
                ref="helpBtnRef"
                type="button"
                class="btn-help-icon"
                title="Xem danh sách placeholder hỗ trợ"
                aria-label="Xem danh sách placeholder hỗ trợ trong prompt_template"
                :aria-expanded="showPromptHelp"
                @click="togglePromptHelp"
              >❓</button>
              <div v-if="showPromptHelp" ref="promptHelpRef" class="qa-prompt-help" role="dialog">
                <p class="qa-prompt-help-title">Placeholder hỗ trợ trong prompt_template:</p>
                <dl>
                  <div v-for="ph in PROMPT_PLACEHOLDERS" :key="ph.token" class="qa-prompt-help-item">
                    <dt><code>{{ ph.token }}</code></dt>
                    <dd>
                      {{ ph.desc }}
                      <span v-if="ph.selectionOnly" class="qa-prompt-help-note">
                        (chỉ có giá trị khi action gắn attach point "Text selection" và được chạy từ vùng đã chọn — trống nếu chạy từ title toolbar)
                      </span>
                    </dd>
                  </div>
                </dl>
                <p class="qa-prompt-help-note qa-prompt-help-write">
                  Lưu ý: để action thực sự thay đổi file, prompt phải yêu cầu agent GHI ĐÈ file
                  (dùng công cụ Write) — stdout của runner KHÔNG được ghi lại vào file.
                </p>
              </div>
            </span>
            <textarea
              v-model="draft.prompt_template"
              class="cfg-textarea"
              rows="4"
              placeholder="Đọc {{artifact_name}} / {{artifact_base}} / {{selection}}…"
            />
          </label>
          <fieldset class="qa-attach-fieldset">
            <legend>Attach points</legend>
            <label v-for="opt in ATTACH_OPTIONS" :key="opt.value" class="qa-attach-option">
              <input
                type="checkbox"
                :checked="draft.attach_points.includes(opt.value)"
                @change="toggleAttach(opt.value, ($event.target as HTMLInputElement).checked)"
              />
              {{ opt.label }}
            </label>
          </fieldset>
          <label class="cfg-label">
            runner (optional — mặc định dùng runner mặc định của hệ thống)
            <select v-model="draft.runner_id" class="cfg-input">
              <option :value="undefined">(default)</option>
              <option v-for="r in runners" :key="r.id" :value="r.id">{{ r.name || r.id }}</option>
            </select>
          </label>
          <label class="qa-attach-option">
            <input v-model="draft.confirm" type="checkbox" />
            Yêu cầu xác nhận trước khi chạy
          </label>
          <label class="qa-attach-option">
            <input v-model="draft.require_approval" type="checkbox" />
            Yêu cầu phê duyệt trước khi ghi (xem diff)
          </label>
        </div>

        <div class="nl-actions">
          <button type="button" class="btn-primary" :disabled="catalog.saving.value" @click="saveForm">
            {{ catalog.saving.value ? 'Đang lưu…' : 'Lưu' }}
          </button>
          <button type="button" class="btn-ghost" @click="closeForm">Hủy</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.quick-action-panel {
  padding: 16px;
  max-width: 880px;
}
.qa-panel-head { margin-bottom: 12px; }
.qa-toolbar { margin-bottom: 10px; }
.qa-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-bottom: 16px;
}
.qa-table th, .qa-table td {
  border: 1px solid var(--border);
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}
.qa-empty { text-align: center; }
.qa-row-actions { display: flex; gap: 6px; white-space: nowrap; }

/* Editor is a modal dialog: resizable and always bounded by the viewport. */
.qa-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.qa-form {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* Sized to the viewport; user can drag the corner to resize within bounds. */
  width: min(720px, 94vw);
  height: min(760px, 88vh);
  min-width: 320px;
  min-height: 260px;
  max-width: 96vw;
  max-height: 92vh;
  overflow: hidden;
  resize: both;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.qa-form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.qa-form-head h3 { margin: 0; }
.qa-form-close { font-size: 15px; }
/* The fields scroll inside the dialog so the header/footer stay put. */
.qa-form-body {
  flex: 1 1 auto;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
}
.qa-attach-fieldset {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  gap: 14px;
}
.qa-attach-option { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.qa-prompt-label-row { position: relative; display: inline-flex; align-items: center; gap: 4px; }
.btn-help-icon {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 0 2px;
  color: var(--muted);
}
.btn-help-icon:hover { color: inherit; }
/* Floating popover: overlays adjacent fields (does not push them down). */
.qa-prompt-help {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  z-index: 20;
  width: min(440px, 82vw);
  max-height: 320px;
  overflow-y: auto;
  font-size: 12px;
  color: var(--muted);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.32);
}
.qa-prompt-help-write { margin: 8px 0 0; padding-top: 6px; border-top: 1px solid var(--border); }
.chip-approval { border-color: var(--accent); color: var(--accent); }
.qa-prompt-help-title { margin: 0 0 6px; }
.qa-prompt-help dl { margin: 0; }
.qa-prompt-help-item { margin-bottom: 6px; }
.qa-prompt-help-item:last-child { margin-bottom: 0; }
.qa-prompt-help-item dt { display: inline; }
.qa-prompt-help-item dd { margin: 2px 0 0; }
.qa-prompt-help-note { display: block; font-style: italic; }
.nl-actions { display: flex; gap: 8px; }
</style>
