<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  fetchRunners,
  saveRunner,
  deleteRunner,
  setDefaultRunner,
  fetchCredentials,
  submitJob,
  fetchJobs,
  fetchJob,
} from '../api.js'

const runners = ref([])
const defaultRunnerId = ref('')
const providers = ref([])
const credentials = ref([])
const selectedId = ref('')
const saving = ref(false)
const testing = ref(false)
const message = ref('')
const error = ref('')
const recentJobs = ref([])

const draft = ref(emptyRunner())

function emptyRunner() {
  return {
    id: 'new-runner',
    name: 'New Runner',
    provider: 'claude-code-cli',
    credentialId: 'claude-default',
    enabled: true,
    maxConcurrency: 1,
    config: {
      cliPath: 'claude',
      flags: [],
      timeoutMs: 600000,
      allowedTools: 'Read,Write,Bash,Grep,Glob',
    },
  }
}

const filteredCredentials = computed(() =>
  credentials.value.filter((p) => p.provider === draft.value.provider),
)

async function load() {
  error.value = ''
  try {
    const [rData, cData, jData] = await Promise.all([
      fetchRunners(),
      fetchCredentials(),
      fetchJobs(10),
    ])
    runners.value = rData.runners || []
    defaultRunnerId.value = rData.defaultRunnerId || ''
    providers.value = rData.providers || ['claude-code-cli']
    credentials.value = cData.profiles || []
    recentJobs.value = jData.jobs || []
    if (!selectedId.value && runners.value.length) {
      selectRunner(runners.value.find((r) => r.id === defaultRunnerId.value) || runners.value[0])
    }
  } catch (e) {
    error.value = String(e.message || e)
  }
}

onMounted(load)

function selectRunner(r) {
  selectedId.value = r.id
  draft.value = JSON.parse(JSON.stringify(r))
  message.value = ''
}

function newRunner() {
  selectedId.value = ''
  draft.value = emptyRunner()
  message.value = ''
}

async function save() {
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    await saveRunner(draft.value)
    message.value = `Đã lưu ${draft.value.id}`
    await load()
    selectedId.value = draft.value.id
  } catch (e) {
    error.value = String(e.message || e)
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!selectedId.value) return
  if (!confirm(`Xóa runner ${selectedId.value}?`)) return
  try {
    await deleteRunner(selectedId.value)
    message.value = 'Đã xóa'
    selectedId.value = ''
    draft.value = emptyRunner()
    await load()
  } catch (e) {
    error.value = String(e.message || e)
  }
}

async function makeDefault() {
  if (!draft.value.id) return
  try {
    await setDefaultRunner(draft.value.id)
    message.value = `Default: ${draft.value.id}`
    await load()
  } catch (e) {
    error.value = String(e.message || e)
  }
}

async function smokeTest() {
  testing.value = true
  error.value = ''
  message.value = ''
  try {
    const { job } = await submitJob({
      runnerId: draft.value.id,
      agentRef: 'dev-agent-teams:investigator',
      workspace: '.',
      userPrompt: 'Reply with exactly: OK',
    })
    message.value = `Job ${job.id} — ${job.status}`
    let current = job
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const data = await fetchJob(job.id)
      current = data.job
      if (current.status === 'succeeded' || current.status === 'failed') break
    }
    message.value = `Smoke test: ${current.status}${current.error ? ` — ${current.error}` : ''}`
    if (current.status === 'failed' && current.logPath) {
      message.value += ` (xem log: ${current.logPath})`
    }
    await load()
  } catch (e) {
    error.value = String(e.message || e)
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="runner-config">
    <header class="runner-head">
      <h2>Runner Config</h2>
      <p class="muted">Quản lý AI Agent Runner (global ~/.dev-team-dashboard/)</p>
    </header>

    <div v-if="error" class="err-banner">{{ error }}</div>
    <div v-if="message" class="ok-banner">{{ message }}</div>

    <div class="runner-layout">
      <aside class="runner-list">
        <button type="button" class="btn" @click="newRunner">+ New</button>
        <ul>
          <li
            v-for="r in runners"
            :key="r.id"
            :class="{ active: r.id === selectedId, default: r.id === defaultRunnerId }"
            @click="selectRunner(r)"
          >
            <strong>{{ r.name }}</strong>
            <span class="muted">{{ r.provider }}</span>
            <span v-if="r.id === defaultRunnerId" class="badge">default</span>
          </li>
        </ul>
      </aside>

      <section class="runner-form">
        <div class="field">
          <label>ID</label>
          <input v-model="draft.id" :disabled="!!selectedId" />
        </div>
        <div class="field">
          <label>Name</label>
          <input v-model="draft.name" />
        </div>
        <div class="field">
          <label>Provider</label>
          <select v-model="draft.provider">
            <option v-for="p in providers" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <div class="field">
          <label>Credential</label>
          <select v-model="draft.credentialId">
            <option v-for="c in filteredCredentials" :key="c.id" :value="c.id">
              {{ c.label }} ({{ c.id }})
            </option>
          </select>
        </div>
        <div class="field">
          <label>CLI path</label>
          <input v-model="draft.config.cliPath" />
        </div>
        <div class="field">
          <label>Allowed tools</label>
          <input v-model="draft.config.allowedTools" />
        </div>
        <div class="field row">
          <label><input v-model="draft.enabled" type="checkbox" /> Enabled</label>
        </div>

        <div class="actions">
          <button type="button" class="btn primary" :disabled="saving" @click="save">Lưu</button>
          <button type="button" class="btn" :disabled="!selectedId" @click="makeDefault">Set default</button>
          <button type="button" class="btn" :disabled="testing" @click="smokeTest">Smoke test</button>
          <button type="button" class="btn danger" :disabled="!selectedId" @click="remove">Xóa</button>
        </div>
      </section>
    </div>

    <section v-if="recentJobs.length" class="recent-jobs">
      <h3>Jobs gần đây</h3>
      <table>
        <thead>
          <tr><th>ID</th><th>Status</th><th>Agent</th><th>Created</th></tr>
        </thead>
        <tbody>
          <tr v-for="j in recentJobs" :key="j.id">
            <td>{{ j.id.slice(0, 8) }}…</td>
            <td>{{ j.status }}</td>
            <td>{{ j.agentRef }}</td>
            <td>{{ j.createdAt }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.runner-config { padding: 1rem 1.25rem; max-width: 960px; }
.runner-head h2 { margin: 0 0 0.25rem; font-size: 1.25rem; font-weight: 500; }
.muted { color: var(--text-muted, #666); font-size: 0.85rem; }
.runner-layout { display: grid; grid-template-columns: 200px 1fr; gap: 1rem; margin-top: 1rem; }
.runner-list ul { list-style: none; padding: 0; margin: 0.5rem 0 0; }
.runner-list li {
  padding: 0.5rem 0.6rem; border-radius: 6px; cursor: pointer; margin-bottom: 4px;
  border: 1px solid transparent;
}
.runner-list li.active { background: var(--gray-light, #f1efe8); border-color: #ccc; }
.runner-list li strong { display: block; font-size: 0.9rem; }
.field { margin-bottom: 0.75rem; }
.field label { display: block; font-size: 0.8rem; margin-bottom: 0.25rem; }
.field input, .field select { width: 100%; max-width: 400px; padding: 0.35rem 0.5rem; }
.actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 1rem; }
.btn { padding: 0.35rem 0.75rem; border-radius: 6px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
.btn.primary { background: #1d9e75; color: #fff; border-color: #1d9e75; }
.btn.danger { color: #c00; }
.badge { font-size: 0.7rem; background: #e1f5ee; padding: 1px 6px; border-radius: 4px; margin-left: 4px; }
.err-banner { background: #fee; padding: 0.5rem; border-radius: 6px; margin: 0.5rem 0; }
.ok-banner { background: #efe; padding: 0.5rem; border-radius: 6px; margin: 0.5rem 0; }
.recent-jobs { margin-top: 2rem; }
.recent-jobs table { width: 100%; font-size: 0.85rem; border-collapse: collapse; }
.recent-jobs th, .recent-jobs td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid #eee; }
</style>
