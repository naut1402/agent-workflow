<script setup lang="ts">
import { computed, watch, nextTick, onUpdated, ref } from 'vue'
import { parseMarkdown, renderMermaid } from '../../../shared/markdown'

const props = defineProps({
  qa: { type: String, default: '' },
})

const viewRoot = ref<HTMLElement | null>(null)
const html = computed(() => parseMarkdown(props.qa || ''))

async function scheduleMermaid() {
  await nextTick()
  await renderMermaid(viewRoot.value)
}

watch(html, () => scheduleMermaid())
onUpdated(() => scheduleMermaid())
</script>

<template>
  <section class="qa">
    <div class="qa-head">⚠ Pipeline đang chờ trả lời câu hỏi blocking</div>
    <div class="qa-hint">
      Mở <code>.dev-team-agent/tasks/&lt;task-id&gt;/qa.md</code>, điền <code>Answer:</code> rồi gõ
      <code>done</code> cho orchestrator.
    </div>
    <div ref="viewRoot" class="md" v-html="html" />
  </section>
</template>
