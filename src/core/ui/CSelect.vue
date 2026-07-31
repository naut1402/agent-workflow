<script setup lang="ts">
import { computed, ref } from 'vue'
import { onClickOutside } from '@vueuse/core'

/** Option row for `CSelect` (Custom Select). */
export type CSelectOption = { value: string; label: string }

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: CSelectOption[]
    disabled?: boolean
    ariaLabel?: string
  }>(),
  { disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const selectedLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? props.modelValue,
)

onClickOutside(rootRef, () => {
  open.value = false
})

function toggle() {
  if (props.disabled) return
  open.value = !open.value
}

function pick(value: string) {
  emit('update:modelValue', value)
  open.value = false
}
</script>

<template>
  <div
    ref="rootRef"
    class="c-select"
    :class="{ 'is-open': open, 'is-disabled': disabled }"
  >
    <button
      type="button"
      class="c-select-trigger"
      :disabled="disabled"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="c-select-value">{{ selectedLabel }}</span>
      <span class="c-select-chevron" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </span>
    </button>

    <ul v-if="open" class="c-select-menu" role="listbox" :aria-label="ariaLabel">
      <li
        v-for="opt in options"
        :key="opt.value"
        role="option"
        class="c-select-option"
        :class="{ 'is-selected': opt.value === modelValue }"
        :aria-selected="opt.value === modelValue"
        @click="pick(opt.value)"
      >
        {{ opt.label }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.c-select {
  position: relative;
  display: block;
  width: 100%;
  max-width: 360px;
}

.c-select-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--input-surface);
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.c-select-trigger:hover:not(:disabled) {
  border-color: var(--muted);
}

.c-select-trigger:focus-visible {
  outline: none;
  border-color: var(--accent);
}

.c-select-trigger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.c-select-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.c-select-chevron {
  flex-shrink: 0;
  display: inline-flex;
  color: var(--muted);
  transition: transform 0.12s ease;
}

.c-select.is-open .c-select-chevron {
  transform: rotate(180deg);
}

.c-select-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 30;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  max-height: 240px;
  overflow-y: auto;
}

.c-select-option {
  padding: 7px 8px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
}

.c-select-option:hover {
  background: var(--hover-surface);
}

.c-select-option.is-selected {
  background: var(--accent-dim);
  color: var(--accent);
}
</style>
