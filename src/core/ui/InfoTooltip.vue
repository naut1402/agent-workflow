<script setup lang="ts">
import { ref } from 'vue'
import { onClickOutside } from '@vueuse/core'

const props = defineProps<{
  text: string
  ariaLabel?: string
}>()

const open = ref(false)
const wrapRef = ref<HTMLElement | null>(null)

function toggle(e?: Event) {
  e?.stopPropagation()
  open.value = !open.value
}

onClickOutside(wrapRef, () => {
  open.value = false
})
</script>

<template>
  <span ref="wrapRef" class="info-tooltip-wrap">
    <button
      type="button"
      class="icon-btn info-tooltip-btn"
      :class="{ active: open }"
      :title="text"
      :aria-label="ariaLabel || text"
      :aria-expanded="open"
      @click="toggle"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.25" />
        <circle cx="8" cy="5.2" r="0.9" fill="currentColor" />
        <path fill="currentColor" d="M7.25 7h1.5v4.75h-1.5z" />
      </svg>
    </button>
    <div v-if="open" class="info-tooltip-tip" role="tooltip">{{ props.text }}</div>
  </span>
</template>

<style scoped>
.info-tooltip-wrap {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.info-tooltip-btn {
  width: 20px;
  height: 20px;
  color: var(--muted);
}

.info-tooltip-tip {
  position: absolute;
  left: 0;
  top: calc(100% + 6px);
  z-index: 5;
  width: min(280px, 70vw);
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel, var(--panel-2, #1e1e24));
  color: var(--text);
  font-size: 12px;
  line-height: 1.45;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
}
</style>
