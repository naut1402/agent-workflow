<script setup>
import { ref } from 'vue'
import { generateAgentDraft } from '../api.js'

const emit = defineEmits(['apply-draft', 'close'])

const description = ref('')
const loading = ref(false)
const error = ref('')

async function generate() {
  if (!description.value.trim()) return
  loading.value = true
  error.value = ''
  try {
    const data = await generateAgentDraft(description.value)
    emit('apply-draft', data.draft)
    emit('close')
  } catch (e) {
    error.value = String(e.message || e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="agent-nl-wizard">
    <h3 class="picker-title">Build từ mô tả (NL)</h3>
    <p class="muted">Nhập mô tả agent bằng tiếng Việt/Anh. Hệ thống tạo draft (heuristic hoặc API nếu có ANTHROPIC_API_KEY).</p>
    <textarea v-model="description" class="cfg-textarea" rows="6" placeholder="Ví dụ: Agent review code PHP theo coding conventions..." />
    <p v-if="error" class="err">{{ error }}</p>
    <div class="nl-actions">
      <button type="button" class="btn-primary" :disabled="loading" @click="generate">
        {{ loading ? 'Đang tạo…' : 'Generate draft' }}
      </button>
      <button type="button" class="btn-ghost" @click="emit('close')">Hủy</button>
    </div>
  </div>
</template>
