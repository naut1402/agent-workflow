<script setup>
// Sidebar project selector + CRUD. Lets the user switch the active project
// (whose tasks the monitor view polls) and add/remove projects in the shared
// registry. Removing a project only detaches it from the dashboard — it never
// touches files on disk.
import { ref } from 'vue'
import { addProject, removeProject } from '../api.js'

const props = defineProps({
  projects: { type: Array, default: () => [] },
  defaultId: { type: String, default: null },
  selectedId: { type: String, default: null },
})

const emit = defineEmits(['select', 'changed'])

const adding = ref(false)
const newPath = ref('')
const newName = ref('')
const busy = ref(false)
const errorMsg = ref('')

function openAdd() {
  adding.value = true
  errorMsg.value = ''
  newPath.value = ''
  newName.value = ''
}

function cancelAdd() {
  adding.value = false
  errorMsg.value = ''
}

async function submitAdd() {
  if (!newPath.value.trim()) {
    errorMsg.value = 'Nhập đường dẫn tới .dev-team-agent (hoặc project root).'
    return
  }
  busy.value = true
  errorMsg.value = ''
  try {
    const { project } = await addProject(newPath.value.trim(), newName.value.trim() || undefined)
    adding.value = false
    emit('changed')
    if (project?.id) emit('select', project.id)
  } catch (e) {
    errorMsg.value = String(e.message || e)
  } finally {
    busy.value = false
  }
}

async function onRemove(project) {
  if (project.default) return
  if (!window.confirm(`Gỡ project "${project.name}" khỏi dashboard?\n(Không xoá file trên đĩa.)`)) return
  busy.value = true
  errorMsg.value = ''
  try {
    await removeProject(project.id)
    emit('changed')
    if (props.selectedId === project.id) emit('select', null)
  } catch (e) {
    errorMsg.value = String(e.message || e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="project-bar">
    <div class="project-bar-head">
      <span class="project-bar-title">Projects</span>
      <button class="project-add-btn" type="button" title="Thêm project" @click="openAdd">＋</button>
    </div>

    <ul class="project-list">
      <li
        v-for="p in projects"
        :key="p.id"
        class="project-item"
        :class="{ active: p.id === selectedId }"
      >
        <button class="project-pick" type="button" @click="emit('select', p.id)">
          <span class="project-name">{{ p.name }}</span>
          <span v-if="p.default" class="project-default-badge">default</span>
        </button>
        <button
          v-if="!p.default"
          class="project-remove"
          type="button"
          title="Gỡ khỏi dashboard"
          @click="onRemove(p)"
        >×</button>
      </li>
      <li v-if="!projects.length" class="project-empty">Chưa có project nào.</li>
    </ul>

    <div v-if="adding" class="project-add-form">
      <input
        v-model="newPath"
        class="project-input"
        placeholder="Đường dẫn .dev-team-agent / project root"
        @keyup.enter="submitAdd"
      />
      <input
        v-model="newName"
        class="project-input"
        placeholder="Tên hiển thị (tuỳ chọn)"
        @keyup.enter="submitAdd"
      />
      <div class="project-add-actions">
        <button class="project-btn primary" type="button" :disabled="busy" @click="submitAdd">
          {{ busy ? '…' : 'Thêm' }}
        </button>
        <button class="project-btn" type="button" :disabled="busy" @click="cancelAdd">Huỷ</button>
      </div>
    </div>

    <p v-if="errorMsg" class="project-err">⚠ {{ errorMsg }}</p>
  </div>
</template>

<style scoped>
.project-bar {
  border-bottom: 1px solid var(--border, #2a2a35);
  padding: 8px 10px;
  font-size: 13px;
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
.project-add-btn {
  background: none;
  border: 1px solid var(--border, #2a2a35);
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  line-height: 1;
  padding: 2px 7px;
}
.project-add-btn:hover { background: rgba(255, 255, 255, 0.06); }
.project-list { list-style: none; margin: 0; padding: 0; }
.project-item {
  display: flex;
  align-items: center;
  border-radius: 5px;
}
.project-item.active { background: rgba(120, 160, 255, 0.16); }
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
.project-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
.project-remove:hover { opacity: 1; color: #ff8080; }
.project-empty { opacity: 0.5; padding: 5px 6px; }
.project-add-form { margin-top: 8px; display: flex; flex-direction: column; gap: 5px; }
.project-input {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border, #2a2a35);
  border-radius: 4px;
  color: inherit;
  padding: 5px 7px;
  font-size: 12px;
}
.project-add-actions { display: flex; gap: 6px; }
.project-btn {
  border: 1px solid var(--border, #2a2a35);
  background: none;
  color: inherit;
  border-radius: 4px;
  cursor: pointer;
  padding: 4px 10px;
  font-size: 12px;
}
.project-btn.primary { background: rgba(120, 160, 255, 0.22); }
.project-btn:disabled { opacity: 0.5; cursor: default; }
.project-err { color: #ff9090; font-size: 12px; margin: 6px 0 0; }
</style>
