<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

/** Option row for `CComboSelect`. */
export type CComboSelectOption = { value: string; label: string }

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: CComboSelectOption[]
    disabled?: boolean
    ariaLabel?: string
    placeholder?: string
    /** Lets the user type a value that isn't in `options` and use it as-is. */
    creatable?: boolean
  }>(),
  { disabled: false, placeholder: '', creatable: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function labelFor(value: string): string {
  return props.options.find((o) => o.value === value)?.label ?? value
}

const open = ref(false)
/** False right after opening — filter stays off until the user actually types, so opening shows the full list. */
const filtering = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)
const text = ref(props.modelValue ? labelFor(props.modelValue) : '')

watch(
  () => props.modelValue,
  (v) => {
    if (open.value) return
    text.value = v ? labelFor(v) : ''
  },
)

const filteredOptions = computed(() => {
  if (!filtering.value) return props.options
  const q = text.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter((o) => o.label.toLowerCase().includes(q))
})

function openPanel() {
  if (props.disabled) return
  open.value = true
  filtering.value = false
}

function onInput() {
  filtering.value = true
  open.value = true
}

function resetText() {
  text.value = props.modelValue ? labelFor(props.modelValue) : ''
}

function pick(opt: CComboSelectOption) {
  text.value = opt.label
  open.value = false
  filtering.value = false
  if (opt.value !== props.modelValue) emit('update:modelValue', opt.value)
}

/** Commits whatever is currently typed: exact option match wins, else a free-typed value when `creatable`, else revert. */
function commitTyped() {
  const raw = text.value.trim()
  if (!raw) {
    if (props.modelValue) emit('update:modelValue', '')
    return
  }
  const exact = props.options.find((o) => o.value === raw || o.label.toLowerCase() === raw.toLowerCase())
  if (exact) {
    text.value = exact.label
    if (exact.value !== props.modelValue) emit('update:modelValue', exact.value)
    return
  }
  if (props.creatable) {
    if (raw !== props.modelValue) emit('update:modelValue', raw)
    return
  }
  resetText()
}

function onBlur() {
  open.value = false
  filtering.value = false
  commitTyped()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (open.value && filtering.value && filteredOptions.value.length === 1) {
      pick(filteredOptions.value[0])
    } else {
      commitTyped()
      open.value = false
      filtering.value = false
    }
  } else if (e.key === 'Escape') {
    resetText()
    open.value = false
    filtering.value = false
  }
}

function clearValue() {
  text.value = ''
  open.value = true
  filtering.value = false
  if (props.modelValue) emit('update:modelValue', '')
  nextTick(() => inputRef.value?.focus())
}
</script>

<template>
  <div class="c-select c-combo-select" :class="{ 'is-open': open, 'is-disabled': disabled }">
    <div class="c-combo-trigger">
      <input
        ref="inputRef"
        v-model="text"
        type="text"
        class="c-combo-input"
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        :aria-expanded="open"
        :aria-label="ariaLabel"
        :disabled="disabled"
        :placeholder="placeholder"
        @focus="openPanel"
        @input="onInput"
        @keydown="onKeydown"
        @blur="onBlur"
      />
      <button
        v-if="modelValue"
        type="button"
        class="c-combo-clear"
        tabindex="-1"
        :aria-label="ariaLabel"
        @mousedown.prevent="clearValue"
      >
        ✕
      </button>
      <span class="c-select-chevron" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </span>
    </div>

    <ul
      v-if="open && filteredOptions.length"
      class="c-select-menu"
      role="listbox"
      :aria-label="ariaLabel"
      @mousedown.prevent
    >
      <li
        v-for="opt in filteredOptions"
        :key="opt.value"
        role="option"
        class="c-select-option"
        :class="{ 'is-selected': opt.value === modelValue }"
        :aria-selected="opt.value === modelValue"
        @click="pick(opt)"
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

.c-combo-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--input-surface);
}

.c-combo-select.is-open .c-combo-trigger,
.c-combo-trigger:focus-within {
  border-color: var(--accent);
}

.c-combo-select.is-disabled .c-combo-trigger {
  opacity: 0.55;
}

.c-combo-input {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 6px 0;
  border: none;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
}

.c-combo-input:focus {
  outline: none;
}

.c-combo-input::placeholder {
  color: var(--muted);
}

.c-combo-clear {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: none;
  color: var(--muted);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.c-combo-clear:hover {
  color: var(--text);
}

.c-select-chevron {
  flex-shrink: 0;
  display: inline-flex;
  color: var(--muted);
  transition: transform 0.12s ease;
}

.c-combo-select.is-open .c-select-chevron {
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
