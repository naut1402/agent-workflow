<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchRunners, fetchCatalog } from '../../../api'
import { useQuickActionCatalog, type QuickActionDraft } from '../composables/useQuickActionCatalog'
import QuickActionMenuDialog from './QuickActionMenuDialog.vue'
import { pocMenus } from '../lib/pocMenuStore'
import type { ArtifactMenuNode } from '../lib/menuTypes'
import {
  addMenuGroup,
  findActionMenuId,
  listMenuGroupOptions,
  setActionMenuMembership,
} from '../lib/menuTree'

const { t } = useI18n()

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
const showMenuDialog = ref(false)
const showCreateMenuDialog = ref(false)
const editingId = ref<string | null>(null)
const isCopyDraft = ref(false)
const formError = ref('')
const message = ref('')
const showPromptHelp = ref(false)
/** Empty string = independent flat button on Monitor toolbar. */
const draftMenuId = ref('')
const createMenuLabel = ref('')
const createMenuParentId = ref('')
const createMenuError = ref('')

const menuGroupOptions = computed(() => listMenuGroupOptions(pocMenus.value))

function menuOptionLabel(opt: { label: string; depth: number }): string {
  return `${'— '.repeat(opt.depth)}${opt.label}`
}

// Danh sách placeholder hỗ trợ trong `prompt_template` — khớp với
// `substitutePrompt()` (server/artifactActions/index.ts). `{{selection}}` và
// `{{selection_lines}}` chỉ có giá trị khi action được chạy từ selection
// toolbar (tức action có gắn attach point "Text selection" và người dùng bôi
// đen một đoạn trong artifact rồi bấm nút) — chạy từ title toolbar thì hai
// placeholder này luôn rỗng.
const PROMPT_PLACEHOLDERS = computed<Array<{ token: string; desc: string; selectionOnly?: boolean }>>(() => [
  { token: '{{artifact_name}}', desc: t('quickAction.promptHelp.placeholders.artifactName') },
  { token: '{{artifact_base}}', desc: t('quickAction.promptHelp.placeholders.artifactBase') },
  {
    token: '{{selection}}',
    desc: t('quickAction.promptHelp.placeholders.selection'),
    selectionOnly: true,
  },
  {
    token: '{{selection_lines}}',
    desc: t('quickAction.promptHelp.placeholders.selectionLines'),
    selectionOnly: true,
  },
])

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
  isCopyDraft.value = false
  editingId.value = null
  draft.value = emptyDraft()
  patternsText.value = ''
  draftMenuId.value = ''
  formError.value = ''
  message.value = ''
  closePromptHelp()
  closeCreateMenuDialog()
  showForm.value = true
}

function openCopy(a: QuickActionDraft) {
  editingId.value = null
  isCopyDraft.value = true
  draft.value = {
    ...a,
    id: '',
    label: `${a.label} (copy)`,
    produces: [...(a.produces ?? [])],
    attach_points: [...(a.attach_points ?? ['artifact-title'])],
    require_approval: a.require_approval ?? false,
  }
  patternsText.value = (a.artifact_patterns ?? []).join(', ')
  // Copy does not inherit menu membership — user picks again (or leave independent).
  draftMenuId.value = ''
  formError.value = ''
  message.value = ''
  closePromptHelp()
  closeCreateMenuDialog()
  showForm.value = true
}

function openEdit(a: QuickActionDraft) {
  isCopyDraft.value = false
  editingId.value = a.id
  draft.value = {
    ...a,
    produces: [...(a.produces ?? [])],
    attach_points: [...(a.attach_points ?? ['artifact-title'])],
    require_approval: a.require_approval ?? false,
  }
  patternsText.value = (a.artifact_patterns ?? []).join(', ')
  draftMenuId.value = findActionMenuId(pocMenus.value, a.id) ?? ''
  formError.value = ''
  message.value = ''
  closePromptHelp()
  closeCreateMenuDialog()
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  editingId.value = null
  isCopyDraft.value = false
  draftMenuId.value = ''
  closePromptHelp()
  closeCreateMenuDialog()
}

function openMenuDialog() {
  showMenuDialog.value = true
}

function closeMenuDialog() {
  showMenuDialog.value = false
}

function saveMenus(menus: ArtifactMenuNode[]) {
  pocMenus.value = menus
  message.value = t('quickAction.menu.save')
  showMenuDialog.value = false
}

function deriveMenuId(label: string): string {
  const base = `menu-${slugify(label) || 'group'}`
  const taken = new Set<string>()
  function walk(nodes: ArtifactMenuNode[]) {
    for (const n of nodes) {
      taken.add(n.id)
      if (n.children?.length) walk(n.children)
    }
  }
  walk(pocMenus.value)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

function openCreateMenuDialog() {
  createMenuLabel.value = ''
  createMenuParentId.value = ''
  createMenuError.value = ''
  showCreateMenuDialog.value = true
}

function closeCreateMenuDialog() {
  showCreateMenuDialog.value = false
  createMenuLabel.value = ''
  createMenuParentId.value = ''
  createMenuError.value = ''
}

function saveCreateMenu() {
  createMenuError.value = ''
  const label = createMenuLabel.value.trim()
  if (!label) {
    createMenuError.value = t('quickAction.menu.createNameRequired')
    return
  }
  const id = deriveMenuId(label)
  pocMenus.value = addMenuGroup(pocMenus.value, {
    id,
    label,
    parentId: createMenuParentId.value || null,
  })
  draftMenuId.value = id
  closeCreateMenuDialog()
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
    formError.value = t('quickAction.errors.labelRequired')
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
    formError.value = catalog.error.value || t('quickAction.errors.saveFailed')
    return
  }
  pocMenus.value = setActionMenuMembership(
    pocMenus.value,
    draft.value.id,
    draft.value.label,
    draftMenuId.value || null,
  )
  message.value = t('quickAction.messages.saved', { label: draft.value.label })
  closeForm()
}

async function removeAction(a: QuickActionDraft) {
  if (typeof window !== 'undefined' && !window.confirm(t('quickAction.confirm.remove', { label: a.label }))) return
  catalog.remove(a.id)
  const ok = await catalog.persist(catalog.actions.value)
  if (ok) {
    pocMenus.value = setActionMenuMembership(pocMenus.value, a.id, a.label, null)
    message.value = t('quickAction.messages.removed', { label: a.label })
  }
}
</script>

<template>
  <div class="quick-action-panel">
    <header class="qa-panel-head">
      <h2>{{ t('quickAction.title') }}</h2>
      <p class="muted">
        {{ t('quickAction.subtitle') }}
      </p>
    </header>

    <div v-if="catalog.error.value" class="err">{{ catalog.error.value }}</div>
    <p v-if="message" class="ok-msg">{{ message }}</p>

    <div class="qa-toolbar">
      <button type="button" class="btn-primary btn-sm" @click="openNew">{{ t('quickAction.newAction') }}</button>
      <button
        type="button"
        class="icon-btn"
        :title="t('quickAction.menu.manage')"
        :aria-label="t('quickAction.menu.manage')"
        @click="openMenuDialog"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M2.5 4h11M2.5 8h11M2.5 12h7" />
        </svg>
      </button>
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
          <td colspan="6" class="muted qa-empty">{{ t('quickAction.empty') }}</td>
        </tr>
        <tr v-for="a in catalog.actions.value" :key="a.id">
          <td>{{ a.label }}</td>
          <td class="muted">{{ (a.artifact_patterns ?? []).join(', ') }}</td>
          <td class="muted">{{ a.agent_ref || t('quickAction.directPrompt') }}</td>
          <td>
            <span v-for="ap in a.attach_points ?? ['artifact-title']" :key="ap" class="chip chip-xs">{{ ap }}</span>
            <span v-if="a.require_approval" class="chip chip-xs chip-approval" :title="t('quickAction.approvalBadgeTitle')">{{ t('quickAction.approvalBadge') }}</span>
          </td>
          <td class="muted">{{ a.runner_id || t('quickAction.runnerDefault') }}</td>
          <td class="qa-row-actions">
            <button
              type="button"
              class="icon-btn"
              :title="t('quickAction.actions.copy')"
              :aria-label="t('quickAction.actions.copy')"
              @click="openCopy(a)"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <rect x="5.5" y="5.5" width="7" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" />
                <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M3.5 10.5V3.5h7" />
              </svg>
            </button>
            <button
              type="button"
              class="icon-btn"
              :title="t('quickAction.actions.edit')"
              :aria-label="t('quickAction.actions.edit')"
              @click="openEdit(a)"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3.5 12.5l1.2-4.2 6.3-6.3 2.1 2.1-6.3 6.3zM9.5 3.5l2.1 2.1"
                />
              </svg>
            </button>
            <button
              type="button"
              class="icon-btn danger"
              :title="t('quickAction.actions.delete')"
              :aria-label="t('quickAction.actions.delete')"
              @click="removeAction(a)"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.4"
                  stroke-linecap="round"
                  d="M3.5 5h9M6 5V3.5h4V5M5 5l.5 8h5L11 5"
                />
              </svg>
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="showForm" class="qa-modal-overlay" @click.self="closeForm">
      <div class="qa-form" role="dialog" aria-modal="true">
        <div class="qa-form-head">
          <h3>{{
            isCopyDraft
              ? t('quickAction.form.copyTitle', { name: draft.label.replace(/ \(copy\)$/, '') })
              : editingId
                ? t('quickAction.form.editTitle', { name: draft.label || editingId })
                : t('quickAction.form.newTitle')
          }}</h3>
          <button
            type="button"
            class="icon-btn"
            :title="t('quickAction.form.close')"
            :aria-label="t('quickAction.form.close')"
            @click="closeForm"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <p v-if="formError" class="err">{{ formError }}</p>

        <div class="qa-form-body">
          <label class="cfg-label">
            label
            <input v-model="draft.label" class="cfg-input" :placeholder="t('quickAction.form.labelPlaceholder')" />
          </label>
          <label class="cfg-label">
            {{ t('quickAction.form.patternsLabel') }}
            <input v-model="patternsText" class="cfg-input" placeholder="design.md, investigate.md, *.md" />
          </label>
          <label class="cfg-label">
            {{ t('quickAction.form.agentLabel') }}
            <select v-model="draft.agent_ref" class="cfg-input">
              <option value="">{{ t('quickAction.form.agentNone') }}</option>
              <option
                v-if="draft.agent_ref && !agentIds.has(draft.agent_ref)"
                :value="draft.agent_ref"
              >{{ t('quickAction.form.agentCurrent', { ref: draft.agent_ref }) }}</option>
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
                class="icon-btn btn-help-icon"
                :title="t('quickAction.form.promptHelpTitleAttr')"
                :aria-label="t('quickAction.form.promptHelpAria')"
                :aria-expanded="showPromptHelp"
                @click="togglePromptHelp"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4" />
                  <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M8 7.2v3.3M8 5.2v.8" />
                </svg>
              </button>
              <div v-if="showPromptHelp" ref="promptHelpRef" class="qa-prompt-help" role="dialog">
                <p class="qa-prompt-help-title">{{ t('quickAction.promptHelp.heading') }}</p>
                <dl>
                  <div v-for="ph in PROMPT_PLACEHOLDERS" :key="ph.token" class="qa-prompt-help-item">
                    <dt><code>{{ ph.token }}</code></dt>
                    <dd>
                      {{ ph.desc }}
                      <span v-if="ph.selectionOnly" class="qa-prompt-help-note">
                        {{ t('quickAction.promptHelp.selectionNote') }}
                      </span>
                    </dd>
                  </div>
                </dl>
                <p class="qa-prompt-help-note qa-prompt-help-write">
                  {{ t('quickAction.promptHelp.writeNote') }}
                </p>
              </div>
            </span>
            <textarea
              v-model="draft.prompt_template"
              class="cfg-textarea"
              rows="4"
              :placeholder="t('quickAction.form.promptPlaceholder')"
            />
          </label>
          <fieldset class="qa-attach-fieldset">
            <legend>{{ t('quickAction.attachPoints') }}</legend>
            <label v-for="opt in ATTACH_OPTIONS" :key="opt.value" class="qa-attach-option">
              <input
                type="checkbox"
                :checked="draft.attach_points.includes(opt.value)"
                @change="toggleAttach(opt.value, ($event.target as HTMLInputElement).checked)"
              />
              {{ opt.label }}
            </label>
          </fieldset>
          <div class="qa-menu-select-row">
            <label class="cfg-label qa-menu-select-field">
              {{ t('quickAction.form.menuLabel') }}
              <select v-model="draftMenuId" class="cfg-input" data-testid="qa-menu-select">
                <option value="">{{ t('quickAction.form.menuNone') }}</option>
                <option v-for="opt in menuGroupOptions" :key="opt.id" :value="opt.id">
                  {{ menuOptionLabel(opt) }}
                </option>
              </select>
            </label>
            <button
              type="button"
              class="icon-btn"
              :title="t('quickAction.form.addMenu')"
              :aria-label="t('quickAction.form.addMenu')"
              data-testid="qa-add-menu"
              @click="openCreateMenuDialog"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M8 3.5v9M3.5 8h9" />
              </svg>
            </button>
          </div>
          <p class="muted qa-menu-select-hint">{{ t('quickAction.form.menuHint') }}</p>
          <label class="cfg-label">
            {{ t('quickAction.form.runnerLabel') }}
            <select v-model="draft.runner_id" class="cfg-input">
              <option :value="undefined">{{ t('quickAction.runnerDefault') }}</option>
              <option v-for="r in runners" :key="r.id" :value="r.id">{{ r.name || r.id }}</option>
            </select>
          </label>
          <label class="qa-attach-option">
            <input v-model="draft.confirm" type="checkbox" />
            {{ t('quickAction.form.confirmOption') }}
          </label>
          <label class="qa-attach-option">
            <input v-model="draft.require_approval" type="checkbox" />
            {{ t('quickAction.form.approvalOption') }}
          </label>
        </div>

        <div class="nl-actions">
          <button type="button" class="btn-primary" :disabled="catalog.saving.value" @click="saveForm">
            {{ catalog.saving.value ? t('quickAction.form.saving') : t('quickAction.form.save') }}
          </button>
          <button type="button" class="btn-ghost" @click="closeForm">{{ t('quickAction.form.cancel') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showCreateMenuDialog" class="qa-modal-overlay qa-create-menu-overlay" @click.self="closeCreateMenuDialog">
      <div class="qa-create-menu-dialog" role="dialog" aria-modal="true" :aria-label="t('quickAction.menu.createTitle')">
        <div class="qa-form-head">
          <h3>{{ t('quickAction.menu.createTitle') }}</h3>
          <button
            type="button"
            class="icon-btn"
            :title="t('quickAction.form.close')"
            :aria-label="t('quickAction.form.close')"
            @click="closeCreateMenuDialog"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <p v-if="createMenuError" class="err">{{ createMenuError }}</p>
        <label class="cfg-label">
          {{ t('quickAction.menu.createNameLabel') }}
          <input
            v-model="createMenuLabel"
            class="cfg-input"
            data-testid="qa-create-menu-name"
            :placeholder="t('quickAction.menu.createNamePlaceholder')"
          />
        </label>
        <label class="cfg-label">
          {{ t('quickAction.menu.createParentLabel') }}
          <select v-model="createMenuParentId" class="cfg-input" data-testid="qa-create-menu-parent">
            <option value="">{{ t('quickAction.menu.createParentNone') }}</option>
            <option v-for="opt in menuGroupOptions" :key="opt.id" :value="opt.id">
              {{ menuOptionLabel(opt) }}
            </option>
          </select>
        </label>
        <div class="nl-actions">
          <button type="button" class="btn-primary" data-testid="qa-create-menu-save" @click="saveCreateMenu">
            {{ t('quickAction.menu.createSave') }}
          </button>
          <button type="button" class="btn-ghost" @click="closeCreateMenuDialog">{{ t('quickAction.form.cancel') }}</button>
        </div>
      </div>
    </div>

    <QuickActionMenuDialog
      v-if="showMenuDialog"
      :menus="pocMenus"
      :actions="catalog.actions.value.map((a) => ({ id: a.id, label: a.label }))"
      @save="saveMenus"
      @close="closeMenuDialog"
    />
  </div>
</template>

<style scoped>
.quick-action-panel {
  padding: 16px;
  max-width: 880px;
}
.qa-panel-head { margin-bottom: 12px; }
.qa-toolbar { margin-bottom: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
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
.qa-row-actions { display: flex; gap: 2px; white-space: nowrap; align-items: center; }

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
.qa-menu-select-row {
  display: flex;
  align-items: flex-end;
  gap: 4px;
}
.qa-menu-select-field { flex: 1 1 auto; margin: 0; }
.qa-menu-select-hint { margin: -4px 0 0; font-size: 12px; }
.qa-create-menu-overlay { z-index: 1100; }
.qa-create-menu-dialog {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  width: min(420px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.qa-prompt-label-row { position: relative; display: inline-flex; align-items: center; gap: 4px; }
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
