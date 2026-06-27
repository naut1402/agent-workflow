<script setup>
import { computed } from 'vue'
import { marked } from 'marked'

const props = defineProps({
  qa: { type: String, default: '' },
})

const html = computed(() => marked.parse(props.qa || ''))
</script>

<template>
  <section class="qa">
    <div class="qa-head">⚠ Pipeline đang chờ trả lời câu hỏi blocking</div>
    <div class="qa-hint">
      Mở <code>.dev-team-agent/tasks/&lt;task-id&gt;/qa.md</code>, điền <code>Answer:</code> rồi gõ
      <code>done</code> cho orchestrator.
    </div>
    <div class="md" v-html="html"></div>
  </section>
</template>
