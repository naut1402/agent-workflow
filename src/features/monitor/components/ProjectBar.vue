<script setup lang="ts">
// Sidebar project selector + CRUD. Two entry points after title:
// ＋ local path, Git clone (separate forms under the header).
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { computed, onBeforeUnmount, ref } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { addProject, removeProject } from '../scripts/monitorApi'
import FolderPickerDialog from '../../../core/ui/FolderPickerDialog.vue'

const { t } = useI18nHelpers()

const props = defineProps({
  projects: { type: Array as () => any[], default: () => [] },
  defaultId: { type: String, default: null },
  selectedId: { type: String, default: null },
})

const emit = defineEmits(['select', 'changed'])

const showLocalForm = ref(false)
const showGitForm = ref(false)
const newPath = ref('')
const newName = ref('')
const gitUrl = ref('')
const gitBranch = ref('main')
const busy = ref(false)
const errorMsg = ref('')
const pickerOpen = ref(false)

const selectOpen = ref(false)
const selectHovering = ref(false)
const selectRootRef = ref<HTMLElement | null>(null)

const selectedProject = computed(
  () => props.projects.find((p) => p.id === props.selectedId) ?? null,
)

const selectedIndex = computed(() =>
  props.projects.findIndex((p) => p.id === props.selectedId),
)

onClickOutside(selectRootRef, () => {
  selectOpen.value = false
})

function clearFields() {
  errorMsg.value = ''
  newPath.value = ''
  newName.value = ''
  gitUrl.value = ''
  gitBranch.value = 'main'
  pickerOpen.value = false
}

function openLocalForm() {
  clearFields()
  showGitForm.value = false
  showLocalForm.value = true
}

function openGitForm() {
  clearFields()
  showLocalForm.value = false
  showGitForm.value = true
}

function closeForms() {
  showLocalForm.value = false
  showGitForm.value = false
  clearFields()
}

function onPicked(path: string) {
  newPath.value = path
  pickerOpen.value = false
}

function selectByOffset(delta: number) {
  const list = props.projects
  if (!list.length) return
  let idx = selectedIndex.value
  if (idx < 0) idx = delta > 0 ? -1 : 0
  const next = (idx + delta + list.length) % list.length
  const id = list[next]?.id
  if (id != null && id !== props.selectedId) emit('select', id)
}

function selectPrev() {
  selectByOffset(-1)
}

function selectNext() {
  selectByOffset(1)
}

function toggleSelect() {
  if (!props.projects.length) return
  selectOpen.value = !selectOpen.value
}

function pickProject(id: string) {
  selectOpen.value = false
  if (id !== props.selectedId) emit('select', id)
}

function onSelectWheel(e: WheelEvent) {
  if (!props.projects.length) return
  e.preventDefault()
  if (e.deltaY > 0) selectNext()
  else if (e.deltaY < 0) selectPrev()
}

function onHoverKeydown(e: KeyboardEvent) {
  if (!selectHovering.value || selectOpen.value) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectNext()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectPrev()
  }
}

function onSelectEnter() {
  selectHovering.value = true
  window.addEventListener('keydown', onHoverKeydown)
}

function onSelectLeave() {
  selectHovering.value = false
  window.removeEventListener('keydown', onHoverKeydown)
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onHoverKeydown)
})

async function submitLocal() {
  if (!newPath.value.trim()) {
    errorMsg.value = t('monitor.projectBar.pathRequired')
    return
  }
  busy.value = true
  errorMsg.value = ''
  try {
    const { project } = await addProject({
      path: newPath.value.trim(),
      name: newName.value.trim() || undefined,
    })
    closeForms()
    emit('changed')
    if (project?.id) emit('select', project.id)
  } catch (e) {
    errorMsg.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

async function submitGit() {
  const url = gitUrl.value.trim()
  if (!url) {
    errorMsg.value = t('monitor.projectBar.gitUrlRequired')
    return
  }
  busy.value = true
  errorMsg.value = ''
  try {
    const { project } = await addProject({
      gitUrl: url,
      branch: gitBranch.value.trim() || 'main',
      name: newName.value.trim() || undefined,
    })
    closeForms()
    emit('changed')
    if (project?.id) emit('select', project.id)
  } catch (e) {
    errorMsg.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}

async function onRemove(project) {
  const confirmMsg = project.default
    ? t('monitor.projectBar.confirmRemoveDefault', { name: project.name })
    : t('monitor.projectBar.confirmRemove', { name: project.name })
  if (!window.confirm(confirmMsg)) return
  busy.value = true
  errorMsg.value = ''
  try {
    await removeProject(project.id)
    emit('changed')
    if (props.selectedId === project.id) emit('select', null)
  } catch (e) {
    errorMsg.value = String((e as Error).message || e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="project-bar">
    <div class="project-bar-head">
      <span class="project-bar-title">Projects</span>
      <div class="project-bar-actions">
        <button
          type="button"
          class="project-add-btn"
          :class="{ active: showLocalForm }"
          :title="t('monitor.projectBar.addTitle')"
          :aria-label="t('monitor.projectBar.addTitle')"
          :disabled="busy"
          @click.stop.prevent="openLocalForm"
        >＋</button>
        <button
          type="button"
          class="project-add-btn project-clone-btn"
          :class="{ active: showGitForm }"
          :title="t('monitor.projectBar.cloneTitle')"
          :aria-label="t('monitor.projectBar.cloneTitle')"
          :disabled="busy"
          @click.stop.prevent="openGitForm"
        >
          <svg class="project-git-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
            <circle cx="4" cy="3" r="1.75" fill="currentColor" />
            <circle cx="4" cy="13" r="1.75" fill="currentColor" />
            <circle cx="12" cy="8" r="1.75" fill="currentColor" />
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              d="M4 4.75v6.5M4 8h6.25"
            />
          </svg>
        </button>
      </div>
    </div>

    <div v-show="showLocalForm" class="project-add-form" data-form="local">
      <div class="project-path-row">
        <input
          v-model="newPath"
          class="project-input"
          :placeholder="t('monitor.projectBar.pathPlaceholder')"
          @keyup.enter="submitLocal"
        />
        <button
          type="button"
          class="icon-btn project-browse-btn"
          :title="t('monitor.projectBar.browse')"
          :aria-label="t('monitor.projectBar.browse')"
          :disabled="busy"
          @click.stop="pickerOpen = true"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path fill="currentColor" d="M2 3h5l1 1h6v9H2V3zm1 2v7h10V5H3z" />
          </svg>
        </button>
      </div>
      <input
        v-model="newName"
        class="project-input"
        :placeholder="t('monitor.projectBar.namePlaceholder')"
        @keyup.enter="submitLocal"
      />
      <div class="project-add-actions">
        <button type="button" class="project-btn primary" :disabled="busy" @click.stop="submitLocal">
          {{ busy ? '…' : t('monitor.projectBar.add') }}
        </button>
        <button type="button" class="project-btn" :disabled="busy" @click.stop="closeForms">
          {{ t('monitor.projectBar.cancel') }}
        </button>
      </div>
    </div>

    <div v-show="showGitForm" class="project-add-form" data-form="git">
      <div class="project-form-label">{{ t('monitor.projectBar.cloneTitle') }}</div>
      <input
        v-model="gitUrl"
        class="project-input"
        :placeholder="t('monitor.projectBar.gitUrlPlaceholder')"
        @keyup.enter="submitGit"
      />
      <input
        v-model="gitBranch"
        class="project-input"
        :placeholder="t('monitor.projectBar.branchPlaceholder')"
        @keyup.enter="submitGit"
      />
      <input
        v-model="newName"
        class="project-input"
        :placeholder="t('monitor.projectBar.namePlaceholder')"
        @keyup.enter="submitGit"
      />
      <div class="project-add-actions">
        <button type="button" class="project-btn primary" :disabled="busy" @click.stop="submitGit">
          {{ busy ? '…' : t('monitor.projectBar.clone') }}
        </button>
        <button type="button" class="project-btn" :disabled="busy" @click.stop="closeForms">
          {{ t('monitor.projectBar.cancel') }}
        </button>
      </div>
    </div>

    <p v-show="errorMsg" class="project-err">⚠ {{ errorMsg }}</p>

    <div v-if="projects.length" class="project-select-row">
      <div
        ref="selectRootRef"
        class="project-select"
        :class="{ 'is-open': selectOpen }"
        @mouseenter="onSelectEnter"
        @mouseleave="onSelectLeave"
        @wheel.prevent="onSelectWheel"
      >
        <button
          type="button"
          class="project-select-trigger"
          :aria-label="t('monitor.projectBar.selectLabel')"
          aria-haspopup="listbox"
          :aria-expanded="selectOpen"
          :disabled="busy"
          @click.stop="toggleSelect"
        >
          <span class="project-select-value">
            <span class="project-name">{{ selectedProject?.name ?? t('monitor.projectBar.selectPlaceholder') }}</span>
            <span v-if="selectedProject?.default" class="project-default-badge">default</span>
          </span>
        </button>

        <ul v-if="selectOpen" class="project-select-menu" role="listbox" :aria-label="t('monitor.projectBar.selectLabel')">
          <li
            v-for="p in projects"
            :key="p.id"
            role="option"
            class="project-item"
            :class="{ active: p.id === selectedId }"
            :aria-selected="p.id === selectedId"
          >
            <button type="button" class="project-pick" @click="pickProject(p.id)">
              <span class="project-name">{{ p.name }}</span>
              <span v-if="p.default" class="project-default-badge">default</span>
            </button>
            <button
              type="button"
              class="project-remove"
              :title="t('monitor.projectBar.removeTitle')"
              :aria-label="t('monitor.projectBar.removeTitle')"
              :disabled="busy"
              @click.stop="onRemove(p)"
            >×</button>
          </li>
        </ul>
      </div>

      <div class="project-nav">
        <button
          type="button"
          class="project-nav-btn"
          :title="t('monitor.projectBar.prevProject')"
          :aria-label="t('monitor.projectBar.prevProject')"
          :disabled="busy || projects.length < 2"
          @click.stop="selectPrev"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 7.5 6 4.5 9 7.5" />
          </svg>
        </button>
        <button
          type="button"
          class="project-nav-btn"
          :title="t('monitor.projectBar.nextProject')"
          :aria-label="t('monitor.projectBar.nextProject')"
          :disabled="busy || projects.length < 2"
          @click.stop="selectNext"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 4.5 6 7.5 9 4.5" />
          </svg>
        </button>
      </div>
    </div>
    <p v-else class="project-empty">{{ t('monitor.projectBar.empty') }}</p>

    <FolderPickerDialog
      v-if="pickerOpen"
      :initial-path="newPath.trim() || undefined"
      @select="onPicked"
      @close="pickerOpen = false"
    />
  </div>
</template>

<style scoped lang="scss">
.project-bar {
  border-bottom: 1px solid var(--border, #2a2a35);
  font-size: 13px;
  flex-shrink: 0;
}
.project-bar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.project-bar-title {
  font-weight: 600;
  opacity: 0.7;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.04em;
}
.project-bar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.project-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 1px solid var(--border, #2a2a35);
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  line-height: 1;
  padding: 2px 7px;
  min-width: 26px;
  min-height: 24px;
}
.project-add-btn:hover,
.project-add-btn.active {
  background: rgba(var(--accent-rgb), 0.22);
  border-color: var(--accent, currentColor);
}
.project-add-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.project-clone-btn {
  padding: 3px 6px;
}
.project-git-icon {
  display: block;
  pointer-events: none;
}
.project-form-label {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.75;
  margin: 0;
}
.project-select-row {
  display: flex;
  align-items: stretch;
  gap: 2px;
  min-width: 0;
}
.project-select {
  position: relative;
  flex: 1;
  min-width: 0;
}
.project-select-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  margin: 0;
  padding: 4px 2px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.project-select-trigger:hover:not(:disabled),
.project-select.is-open .project-select-trigger {
  background: rgba(var(--accent-rgb), 0.12);
}
.project-select-trigger:focus-visible {
  outline: none;
  background: rgba(var(--accent-rgb), 0.16);
}
.project-select-trigger:disabled {
  opacity: 0.5;
  cursor: default;
}
.project-select-value {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}
.project-select-menu {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  z-index: 30;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--panel-2, var(--panel, #1a1a22));
  border: 1px solid var(--border, #2a2a35);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  max-height: 220px;
  overflow-y: auto;
}
.project-nav {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 1px;
}
.project-nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  width: 20px;
  height: 14px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  opacity: 0.55;
  cursor: pointer;
}
.project-nav-btn:hover:not(:disabled) {
  opacity: 1;
  background: rgba(var(--accent-rgb), 0.16);
}
.project-nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.project-item {
  display: flex;
  align-items: center;
  border-radius: 5px;
}
.project-item.active {
  background: rgba(var(--accent-rgb), 0.16);
}
.project-pick {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  text-align: left;
  padding: 5px 6px;
  overflow: hidden;
  min-width: 0;
}
.project-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-default-badge {
  flex-shrink: 0;
  font-size: 10px;
  opacity: 0.6;
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 4px;
}
.project-remove {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.5;
  padding: 0 7px;
  font-size: 16px;
}
.project-remove:hover:not(:disabled) {
  opacity: 1;
  color: var(--danger);
}
.project-remove:disabled {
  opacity: 0.3;
  cursor: default;
}
.project-empty {
  opacity: 0.5;
  padding: 2px 0;
  margin: 0;
}
.project-add-form {
  margin: 0 0 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  padding: 4px;
  border: 1px solid var(--border, #2a2a35);
  border-radius: 6px;
  background: var(--panel-2, var(--panel, transparent));
}
.project-path-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.project-path-row .project-input {
  flex: 1;
  min-width: 0;
}
.project-browse-btn {
  flex-shrink: 0;
}
.project-input {
  background: var(--input-surface, var(--bg, #111));
  border: 1px solid var(--border, #2a2a35);
  border-radius: 4px;
  color: inherit;
  padding: 5px 7px;
  font-size: 12px;
  width: 100%;
  box-sizing: border-box;
}
.project-add-actions {
  display: flex;
  gap: 6px;
}
.project-btn {
  border: 1px solid var(--border, #2a2a35);
  background: none;
  color: inherit;
  border-radius: 4px;
  cursor: pointer;
  padding: 4px 10px;
  font-size: 12px;
}
.project-btn.primary {
  background: rgba(var(--accent-rgb), 0.22);
}
.project-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.project-err {
  color: var(--danger);
  font-size: 12px;
  margin: 0 0 4px;
}
</style>
