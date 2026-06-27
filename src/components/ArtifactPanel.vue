<script setup>
import { ref, computed, watch } from 'vue'
import { marked } from 'marked'
import { fetchArtifact } from '../api.js'

const props = defineProps({
  task: { type: Object, required: true },
  openArtifact: { type: Object, default: null }, // { taskId, name }
  projectId: { type: String, default: null }, // active project (null = default)
})

const content = ref('')
const loadedKey = ref(null)
const loadedMtime = ref(null)
const blockMode = ref(false)

const html = computed(() => marked.parse(content.value || ''))

// Parse markdown into H2-level sections for block view (pre-rendered to HTML).
const blocks = computed(() => {
  if (!content.value) return []
  const sections = []
  const parts = content.value.split(/^(?=##\s)/m)
  for (const part of parts) {
    if (!part.trim()) continue
    const firstLine = part.split('\n')[0]
    const isH2 = firstLine.startsWith('## ')
    sections.push({
      heading: isH2 ? firstLine.replace(/^##\s+/, '') : null,
      html: marked.parse(part.trim()),
    })
  }
  return sections
})

async function load(taskId, name) {
  const key = `${taskId}/${name}`
  loadedKey.value = key
  try {
    const res = await fetchArtifact(taskId, name, props.projectId)
    if (loadedKey.value === key) {
      content.value = res.content
      loadedMtime.value = res.mtime
    }
  } catch {
    if (loadedKey.value === key) content.value = ''
  }
}

watch(
  () => props.openArtifact,
  (a) => {
    if (a) load(a.taskId, a.name)
    else { content.value = ''; loadedKey.value = null; loadedMtime.value = null }
  },
  { immediate: true },
)

// Reset block mode when switching artifact.
watch(() => props.openArtifact?.name, () => { blockMode.value = false })

// Realtime: reload if the open file was modified on disk.
watch(
  () => {
    if (!props.openArtifact) return null
    return props.task.artifacts?.[props.openArtifact.name]?.mtime
  },
  (mtime) => {
    if (props.openArtifact && mtime && mtime !== loadedMtime.value) {
      load(props.openArtifact.taskId, props.openArtifact.name)
    }
  },
)
</script>

<template>
  <div class="art-view">
    <div v-if="!openArtifact" class="art-empty">Chọn một tài liệu từ danh sách bên trái.</div>

    <template v-else>
      <div class="art-toolbar">
        <span class="art-title">{{ openArtifact.name }}</span>
        <button
          v-if="blocks.length > 1"
          class="btn-view-toggle"
          :class="{ active: blockMode }"
          @click="blockMode = !blockMode"
          :title="blockMode ? 'Chuyển sang Full view' : 'Chuyển sang Block view'"
        >{{ blockMode ? '📄 Full' : '🗂 Blocks' }}</button>
      </div>

      <!-- Block view: sections as collapsible <details> -->
      <div v-if="blockMode" class="block-list">
        <details
          v-for="(block, i) in blocks"
          :key="i"
          class="block-item"
          :open="i < 3"
        >
          <summary v-if="block.heading">{{ block.heading }}</summary>
          <div class="md block-content" v-html="block.html" />
        </details>
      </div>

      <!-- Full view: single markdown blob -->
      <div v-else class="md" v-html="html" />
    </template>
  </div>
</template>
