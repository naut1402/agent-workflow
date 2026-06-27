<script setup>
import { ref, onMounted } from 'vue'
import { fetchPipelineProfiles, fetchPipelineProfile, savePipelineProfile, deletePipelineProfile } from '../api.js'

const props = defineProps({
  currentPipeline: { type: Object, required: true },
})

const emit = defineEmits(['load'])

const profiles = ref([])
const selected = ref('')
const saveAsName = ref('')
const saving = ref(false)
const deleting = ref(false)
const error = ref('')

async function loadProfiles() {
  try {
    const data = await fetchPipelineProfiles()
    profiles.value = data.profiles || []
  } catch (e) {
    error.value = String(e.message || e)
  }
}

onMounted(loadProfiles)

async function handleLoad() {
  if (!selected.value) return
  error.value = ''
  try {
    const data = await fetchPipelineProfile(selected.value)
    emit('load', data.pipeline)
  } catch (e) {
    error.value = String(e.message || e)
  }
}

async function handleSave() {
  const name = saveAsName.value.trim()
  if (!name) return
  saving.value = true
  error.value = ''
  try {
    await savePipelineProfile(name, props.currentPipeline)
    saveAsName.value = ''
    await loadProfiles()
    selected.value = name
  } catch (e) {
    error.value = String(e.message || e)
  } finally {
    saving.value = false
  }
}

async function handleDelete() {
  if (!selected.value) return
  deleting.value = true
  error.value = ''
  try {
    await deletePipelineProfile(selected.value)
    selected.value = ''
    await loadProfiles()
  } catch (e) {
    error.value = String(e.message || e)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="profile-manager">
    <span class="profile-label">Profile:</span>

    <select v-model="selected" class="profile-select">
      <option value="">— select profile —</option>
      <option v-for="p in profiles" :key="p.name" :value="p.name">{{ p.name }}</option>
    </select>

    <button class="btn-ghost btn-sm" :disabled="!selected" @click="handleLoad">Load</button>
    <button class="btn-ghost btn-sm btn-danger" :disabled="!selected || deleting" @click="handleDelete">
      {{ deleting ? '…' : 'Delete' }}
    </button>

    <span class="profile-sep">|</span>

    <input v-model="saveAsName" class="profile-input" placeholder="Save as…" @keydown.enter="handleSave" />
    <button class="btn-primary btn-sm" :disabled="!saveAsName.trim() || saving" @click="handleSave">
      {{ saving ? 'Saving…' : 'Save' }}
    </button>

    <span v-if="error" class="profile-error">{{ error }}</span>
  </div>
</template>
