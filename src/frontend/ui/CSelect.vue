<script setup lang="ts">
import { computed, ref } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { useI18nHelpers } from '../composables/useI18nHelpers'

/** Option row for `CSelect` (Custom Select). */
export type CSelectOption = { value: string; label: string }

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: CSelectOption[]
    disabled?: boolean
    ariaLabel?: string
    /** Shown on the trigger when `modelValue` doesn't match any option (e.g. nothing picked yet). */
    placeholder?: string
  }>(),
  { disabled: false, placeholder: '' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { t } = useI18nHelpers()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
/** Roving highlight for arrow-key navigation — independent of `modelValue` while the menu is open. */
const highlightedIndex = ref(0)

const selectedLabel = computed(() => {
  const match = props.options.find((o) => o.value === props.modelValue)
  if (match) return match.label
  return props.modelValue || props.placeholder
})

onClickOutside(rootRef, () => {
  open.value = false
})

function selectedIndex(): number {
  const idx = props.options.findIndex((o) => o.value === props.modelValue)
  return idx >= 0 ? idx : 0
}

function openMenu() {
  if (props.disabled) return
  highlightedIndex.value = selectedIndex()
  open.value = true
}

function toggle() {
  if (props.disabled) return
  if (open.value) {
    open.value = false
  } else {
    openMenu()
  }
}

function pick(value: string) {
  emit('update:modelValue', value)
  open.value = false
}

function moveHighlight(delta: number) {
  if (!props.options.length) return
  const n = props.options.length
  highlightedIndex.value = (highlightedIndex.value + delta + n) % n
}

function onTriggerKeydown(e: KeyboardEvent) {
  if (props.disabled) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const wasOpen = open.value
    if (!wasOpen) openMenu()
    moveHighlight(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    const wasOpen = open.value
    if (!wasOpen) openMenu()
    moveHighlight(-1)
  } else if (e.key === 'Enter' || e.key === ' ') {
    if (open.value) {
      e.preventDefault()
      const opt = props.options[highlightedIndex.value]
      if (opt) pick(opt.value)
    }
  } else if (e.key === 'Escape') {
    if (open.value) {
      e.preventDefault()
      open.value = false
    }
  }
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
      @keydown="onTriggerKeydown"
    >
      <span class="c-select-value" :class="{ 'is-placeholder': !options.find((o) => o.value === modelValue) && !modelValue }">{{ selectedLabel }}</span>
      <span class="c-select-chevron" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </span>
    </button>

    <ul v-if="open" class="c-select-menu" role="listbox" :aria-label="ariaLabel">
      <li v-if="!options.length" class="c-select-empty">{{ t('common.select.empty') }}</li>
      <li
        v-for="(opt, index) in options"
        :key="opt.value"
        role="option"
        class="c-select-option"
        :class="{ 'is-selected': opt.value === modelValue, 'is-highlighted': index === highlightedIndex }"
        :aria-selected="opt.value === modelValue"
        @mouseenter="highlightedIndex = index"
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

.c-select-value.is-placeholder {
  color: var(--muted);
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

.c-select-option.is-highlighted {
  background: var(--hover-surface);
}

.c-select-empty {
  padding: 7px 8px;
  font-size: 13px;
  color: var(--muted);
}
</style>
