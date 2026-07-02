<script setup lang="ts">
import { ref, computed, watch, nextTick, onUpdated } from 'vue'
import { parseMarkdown, renderMermaid } from '../../../shared/markdown'
import { fetchArtifact } from '../../../api'

const props = defineProps({
  task: { type: Object, required: true },
  openArtifact: { type: Object, default: null },
  projectId: { type: String, default: null },
})

const content = ref('')
const loadedKey = ref<string | null>(null)
const loadedMtime = ref<number | null>(null)
const blockMode = ref(false)
const viewRoot = ref<HTMLElement | null>(null)

const html = computed(() => parseMarkdown(content.value || ''))

const blocks = computed(() => {
  if (!content.value) return []
  const sections: { heading: string | null; html: string }[] = []
  const parts = content.value.split(/^(?=##\s)/m)
  for (const part of parts) {
    if (!part.trim()) continue
    const firstLine = part.split('\n')[0]
    const isH2 = firstLine.startsWith('## ')
    sections.push({
      heading: isH2 ? firstLine.replace(/^##\s+/, '') : null,
      html: parseMarkdown(part.trim()),
    })
  }
  return sections
})

async function load(taskId: string, name: string) {
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

async function scheduleMermaid() {
  await nextTick()
  await renderMermaid(viewRoot.value)
}

function onBlockToggle(ev: Event) {
  const el = ev.target as HTMLDetailsElement
  if (el.open) scheduleMermaid()
}

watch(
  () => props.openArtifact,
  (a) => {
    if (a) load(a.taskId, a.name)
    else { content.value = ''; loadedKey.value = null; loadedMtime.value = null }
  },
  { immediate: true },
)

watch(() => props.openArtifact?.name, () => { blockMode.value = false })

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

watch([html, blockMode], () => scheduleMermaid())
onUpdated(() => scheduleMermaid())
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

      <div ref="viewRoot">
        <div v-if="blockMode" class="block-list">
          <details
            v-for="(block, i) in blocks"
            :key="i"
            class="block-item"
            :open="i < 3"
            @toggle="onBlockToggle"
          >
            <summary v-if="block.heading">{{ block.heading }}</summary>
            <div class="md block-content" v-html="block.html" />
          </details>
        </div>
        <div v-else class="md" v-html="html" />
      </div>
    </template>
  </div>
</template>
