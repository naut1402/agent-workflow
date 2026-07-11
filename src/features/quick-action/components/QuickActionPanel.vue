<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { fetchRunners } from '../../../api'
import { useQuickActionCatalog, type QuickActionDraft } from '../composables/useQuickActionCatalog'

// CRUD panel for the artifact-actions catalog (Correction B / F0005): create,
// edit, delete a "quick action" — the prompt/agent/attach-point/runner binding
// that shows up as a button on the artifact title toolbar and/or the
// text-selection toolbar in Monitor's ArtifactPanel.

const props = defineProps<{
  projectId?: string | null
}>()

const ATTACH_OPTIONS = [
  { value: 'artifact-title', label: 'Artifact title' },
  { value: 'artifact-selection', label: 'Text selection' },
]

const catalog = useQuickActionCatalog({ getProjectId: () => props.projectId ?? null })
const runners = ref<Array<{ id: string; name: string }>>([])

const showForm = ref(false)
const editingId = ref<string | null>(null)
const formError = ref('')
const message = ref('')

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
  }
}

const draft = ref<QuickActionDraft>(emptyDraft())
const patternsText = ref('')

async function loadRunnerOptions() {
  try {
    const res = await fetchRunners()
    runners.value = Array.isArray(res?.runners) ? res.runners : []
  } catch {
    runners.value = []
  }
}

onMounted(async () => {
  await Promise.all([catalog.load(), loadRunnerOptions()])
})

function openNew() {
  editingId.value = null
  draft.value = emptyDraft()
  patternsText.value = ''
  formError.value = ''
  message.value = ''
  showForm.value = true
}

function openEdit(a: QuickActionDraft) {
  editingId.value = a.id
  draft.value = { ...a, produces: [...(a.produces ?? [])], attach_points: [...(a.attach_points ?? ['artifact-title'])] }
  patternsText.value = (a.artifact_patterns ?? []).join(', ')
  formError.value = ''
  message.value = ''
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  editingId.value = null
}

function toggleAttach(value: string, checked: boolean) {
  const set = new Set(draft.value.attach_points)
  if (checked) set.add(value)
  else set.delete(value)
  draft.value.attach_points = Array.from(set)
}

async function saveForm() {
  formError.value = ''
  draft.value.artifact_patterns = patternsText.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

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
  message.value = `Đã lưu "${draft.value.id}"`
  closeForm()
}

async function removeAction(a: QuickActionDraft) {
  if (typeof window !== 'undefined' && !window.confirm(`Xóa quick action "${a.id}"?`)) return
  catalog.remove(a.id)
  const ok = await catalog.persist(catalog.actions.value)
  if (ok) message.value = `Đã xóa "${a.id}"`
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
          <th>id</th>
          <th>label</th>
          <th>patterns</th>
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
          <td><code>{{ a.id }}</code></td>
          <td>{{ a.label }}</td>
          <td class="muted">{{ (a.artifact_patterns ?? []).join(', ') }}</td>
          <td>
            <span v-for="ap in a.attach_points ?? ['artifact-title']" :key="ap" class="chip chip-xs">{{ ap }}</span>
          </td>
          <td class="muted">{{ a.runner_id || '(default)' }}</td>
          <td class="qa-row-actions">
            <button type="button" class="btn-ghost btn-sm" @click="openEdit(a)">Sửa</button>
            <button type="button" class="btn-ghost btn-sm btn-danger" @click="removeAction(a)">Xóa</button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="showForm" class="qa-form">
      <h3>{{ editingId ? `Sửa "${editingId}"` : 'Quick action mới' }}</h3>
      <p v-if="formError" class="err">{{ formError }}</p>

      <label class="cfg-label">
        id
        <input v-model="draft.id" class="cfg-input" :disabled="!!editingId" placeholder="improve-doc" />
      </label>
      <label class="cfg-label">
        label
        <input v-model="draft.label" class="cfg-input" placeholder="✨ Cải thiện tài liệu" />
      </label>
      <label class="cfg-label">
        artifact_patterns (phân tách bằng dấu phẩy)
        <input v-model="patternsText" class="cfg-input" placeholder="design.md, investigate.md, *.md" />
      </label>
      <label class="cfg-label">
        agent_ref (tuỳ chọn — để trống thì chạy thẳng prompt_template, không gắn vai trò agent riêng)
        <input v-model="draft.agent_ref" class="cfg-input" placeholder="để trống, hoặc project:my-agent" />
      </label>
      <label class="cfg-label">
        prompt_template
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

      <div class="nl-actions">
        <button type="button" class="btn-primary" :disabled="catalog.saving.value" @click="saveForm">
          {{ catalog.saving.value ? 'Đang lưu…' : 'Lưu' }}
        </button>
        <button type="button" class="btn-ghost" @click="closeForm">Hủy</button>
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
.qa-form {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 560px;
}
.qa-attach-fieldset {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  gap: 14px;
}
.qa-attach-option { display: flex; align-items: center; gap: 6px; font-size: 13px; }
</style>
