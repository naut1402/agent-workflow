<script setup lang="ts">
// Sidebar project selector + CRUD. Two entry points after title:
// ＋ local path, Git clone (separate forms under the header).
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
import { ref } from 'vue'
import { addProject, removeProject } from '../../settings/scripts/settingsApi'
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

    <ul class="project-list">
      <li
        v-for="p in projects"
        :key="p.id"
        class="project-item"
        :class="{ active: p.id === selectedId }"
      >
        <button type="button" class="project-pick" @click="emit('select', p.id)">
          <span class="project-name">{{ p.name }}</span>
          <span v-if="p.default" class="project-default-badge">default</span>
        </button>
        <button
          type="button"
          class="project-remove"
          :title="t('monitor.projectBar.removeTitle')"
          @click="onRemove(p)"
        >×</button>
      </li>
      <li v-if="!projects.length" class="project-empty">{{ t('monitor.projectBar.empty') }}</li>
    </ul>

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
  padding: 8px 10px;
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
  margin-bottom: 2px;
}
.project-list {
  list-style: none;
  margin: 0;
  padding: 0;
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
}
.project-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-default-badge {
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
.project-remove:hover {
  opacity: 1;
  color: var(--danger);
}
.project-empty {
  opacity: 0.5;
  padding: 5px 6px;
}
.project-add-form {
  margin: 0 0 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex-shrink: 0;
  padding: 8px;
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
  margin: 0 0 6px;
}
</style>
