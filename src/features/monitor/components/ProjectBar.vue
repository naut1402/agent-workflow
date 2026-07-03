<script setup lang="ts">
import { ref } from 'vue'
import { addProject, addSshProject, removeProject, pullProjectCache, fetchRunners } from '../../../api'

const props = defineProps({
  projects: { type: Array as () => any[], default: () => [] },
  defaultId: { type: String, default: null },
  selectedId: { type: String, default: null },
})

const emit = defineEmits(['select', 'changed'])

const addTab = ref<'local' | 'ssh'>('local')
const adding = ref(false)
const newPath = ref('')
const newName = ref('')
const sshRemotePath = ref('')
const sshHost = ref('')
const sshUser = ref('')
const sshPort = ref(22)
const sshRunnerId = ref('')
const sshRunners = ref<any[]>([])
const busy = ref(false)
const pullBusyId = ref<string | null>(null)
const errorMsg = ref('')

function formatSyncedAt(iso?: string) {
  if (!iso) return 'Chưa đồng bộ'
  try {
    return new Date(iso).toLocaleString('vi-VN')
  } catch {
    return iso
  }
}

async function loadSshRunners() {
  try {
    const data = await fetchRunners()
    sshRunners.value = (data.runners || []).filter((r: any) => r.provider === 'claude-code-ssh')
    if (!sshRunnerId.value && sshRunners.value.length) {
      sshRunnerId.value = sshRunners.value[0].id
    }
  } catch {
    sshRunners.value = []
  }
}

function openAdd() {
  adding.value = true
  errorMsg.value = ''
  newPath.value = ''
  newName.value = ''
  sshRemotePath.value = ''
  sshHost.value = ''
  sshUser.value = ''
  sshPort.value = 22
  addTab.value = 'local'
  loadSshRunners()
}

function cancelAdd() {
  adding.value = false
  errorMsg.value = ''
}

async function submitAddLocal() {
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
  } catch (e: unknown) {
    errorMsg.value = String(e instanceof Error ? e.message : e)
  } finally {
    busy.value = false
  }
}

async function submitAddSsh() {
  if (!sshRemotePath.value.trim() || !sshHost.value.trim() || !sshUser.value.trim() || !sshRunnerId.value) {
    errorMsg.value = 'Điền remote path, host, user và chọn runner SSH.'
    return
  }
  busy.value = true
  errorMsg.value = ''
  try {
    const { project } = await addSshProject({
      kind: 'ssh',
      remotePath: sshRemotePath.value.trim(),
      name: newName.value.trim() || undefined,
      remote: {
        host: sshHost.value.trim(),
        user: sshUser.value.trim(),
        port: sshPort.value || 22,
        runnerId: sshRunnerId.value,
      },
    })
    adding.value = false
    emit('changed')
    if (project?.id) emit('select', project.id)
  } catch (e: unknown) {
    errorMsg.value = String(e instanceof Error ? e.message : e)
  } finally {
    busy.value = false
  }
}

async function onPullCache(project: any) {
  pullBusyId.value = project.id
  errorMsg.value = ''
  try {
    await pullProjectCache(project.id)
    emit('changed')
  } catch (e: unknown) {
    errorMsg.value = String(e instanceof Error ? e.message : e)
  } finally {
    pullBusyId.value = null
  }
}

async function onRemove(project: any) {
  if (project.default) return
  if (!window.confirm(`Gỡ project "${project.name}" khỏi dashboard?\n(Không xoá file trên đĩa.)`)) return
  busy.value = true
  errorMsg.value = ''
  try {
    await removeProject(project.id)
    emit('changed')
    if (props.selectedId === project.id) emit('select', null)
  } catch (e: unknown) {
    errorMsg.value = String(e instanceof Error ? e.message : e)
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
          <span v-if="p.kind === 'ssh'" class="project-ssh-badge">SSH</span>
          <span v-if="p.default" class="project-default-badge">default</span>
        </button>
        <button
          v-if="p.kind === 'ssh'"
          class="project-sync"
          type="button"
          title="Đồng bộ cache"
          aria-label="Đồng bộ cache"
          :disabled="pullBusyId === p.id"
          @click.stop="onPullCache(p)"
        >
          {{ pullBusyId === p.id ? '…' : '↻' }}
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

    <ul v-if="projects.some((p) => p.kind === 'ssh')" class="project-sync-info">
      <li v-for="p in projects.filter((x) => x.kind === 'ssh')" :key="p.id + '-sync'" class="sync-line">
        <span class="sync-name">{{ p.name }}:</span>
        <span class="sync-at">{{ formatSyncedAt(p.remote?.lastSyncedAt) }}</span>
      </li>
    </ul>

    <div v-if="adding" class="project-add-form">
      <div class="project-tabs">
        <button
          type="button"
          :class="{ active: addTab === 'local' }"
          @click="addTab = 'local'"
        >Đường dẫn local</button>
        <button
          type="button"
          :class="{ active: addTab === 'ssh' }"
          @click="addTab = 'ssh'"
        >SSH remote</button>
      </div>

      <template v-if="addTab === 'local'">
        <input
          v-model="newPath"
          class="project-input"
          placeholder="Đường dẫn .dev-team-agent / project root"
          @keyup.enter="submitAddLocal"
        />
        <input
          v-model="newName"
          class="project-input"
          placeholder="Tên hiển thị (tuỳ chọn)"
          @keyup.enter="submitAddLocal"
        />
        <div class="project-add-actions">
          <button class="project-btn primary" type="button" :disabled="busy" @click="submitAddLocal">
            {{ busy ? '…' : 'Thêm' }}
          </button>
          <button class="project-btn" type="button" :disabled="busy" @click="cancelAdd">Huỷ</button>
        </div>
      </template>

      <template v-else>
        <input v-model="sshRemotePath" class="project-input" placeholder="Remote path (POSIX, vd /Users/dev/.../.dev-team-agent)" />
        <input v-model="sshHost" class="project-input" placeholder="Máy chủ (host)" />
        <input v-model="sshUser" class="project-input" placeholder="User SSH" />
        <input v-model.number="sshPort" type="number" class="project-input" placeholder="Cổng (port)" />
        <select v-model="sshRunnerId" class="project-input">
          <option value="" disabled>Chọn runner SSH</option>
          <option v-for="r in sshRunners" :key="r.id" :value="r.id">{{ r.name }} ({{ r.id }})</option>
        </select>
        <input v-model="newName" class="project-input" placeholder="Tên hiển thị (tuỳ chọn)" />
        <div class="project-add-actions">
          <button class="project-btn primary" type="button" :disabled="busy" @click="submitAddSsh">
            {{ busy ? '…' : 'Thêm SSH project' }}
          </button>
          <button class="project-btn" type="button" :disabled="busy" @click="cancelAdd">Huỷ</button>
        </div>
      </template>
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
.project-ssh-badge {
  font-size: 10px;
  background: rgba(255, 180, 80, 0.2);
  color: #ffb450;
  border-radius: 3px;
  padding: 0 4px;
}
.project-default-badge {
  font-size: 10px;
  opacity: 0.6;
  border: 1px solid currentColor;
  border-radius: 3px;
  padding: 0 4px;
}
.project-sync {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
  padding: 0 5px;
  font-size: 14px;
}
.project-sync:hover { opacity: 1; }
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
.project-sync-info { list-style: none; margin: 6px 0 0; padding: 0; font-size: 11px; opacity: 0.75; }
.sync-line { padding: 2px 6px; }
.sync-name { margin-right: 4px; }
.project-add-form { margin-top: 8px; display: flex; flex-direction: column; gap: 5px; }
.project-tabs { display: flex; gap: 4px; margin-bottom: 4px; }
.project-tabs button {
  flex: 1;
  border: 1px solid var(--border, #2a2a35);
  background: none;
  color: inherit;
  border-radius: 4px;
  cursor: pointer;
  padding: 4px;
  font-size: 11px;
}
.project-tabs button.active { background: rgba(120, 160, 255, 0.22); }
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
