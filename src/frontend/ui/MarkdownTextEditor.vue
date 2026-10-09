<script setup lang="ts">
// xem docs/architecture/code/frontend.md §6
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from 'vue'
import type Editor from '@toast-ui/editor'
import type { EditorType } from '@toast-ui/editor'

import '@toast-ui/editor/dist/toastui-editor.css'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'

const props = withDefaults(
  defineProps<{
    modelValue: string
    height?: string
    disabled?: boolean
    initialEditType?: EditorType
    hideModeSwitch?: boolean
    autofocus?: boolean
    previewStyle?: 'tab' | 'vertical'
  }>(),
  {
    height: '320px',
    disabled: false,
    initialEditType: 'markdown',
    hideModeSwitch: false,
    autofocus: false,
    previewStyle: 'tab',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  blur: []
  focus: []
}>()

const rootEl: Ref<HTMLDivElement | null> = ref(null)
let editor: Editor | null = null
let themeObserver: MutationObserver | null = null
let syncingFromProp = false

function readDocumentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark'
  const attr = document.documentElement.getAttribute('data-theme')
  return attr === 'light' ? 'light' : 'dark'
}

function applyEditorTheme(theme: 'light' | 'dark') {
  const ui = rootEl.value?.querySelector('.toastui-editor-defaultUI')
  if (!ui) return
  if (theme === 'dark') ui.classList.add('toastui-editor-dark')
  else ui.classList.remove('toastui-editor-dark')
}

function emitMarkdown() {
  if (!editor || syncingFromProp) return
  emit('update:modelValue', editor.getMarkdown())
}

// xem docs/architecture/code/frontend.md §6
let focusInside = false

function onEditorFocusIn() {
  focusInside = true
}

function handleEditorBlur() {
  queueMicrotask(() => {
    if (!rootEl.value) return
    if (rootEl.value.contains(document.activeElement)) return
    if (!focusInside) return
    focusInside = false
    emit('blur')
  })
}

function handleEditorFocus() {
  focusInside = true
  emit('focus')
}

async function createEditor() {
  if (!rootEl.value) return
  const { default: ToastEditor } = await import('@toast-ui/editor')
  if (!rootEl.value) return
  const theme = readDocumentTheme()
  editor = new ToastEditor({
    el: rootEl.value,
    height: props.height,
    initialValue: props.modelValue ?? '',
    initialEditType: props.initialEditType,
    hideModeSwitch: props.hideModeSwitch,
    previewStyle: props.previewStyle,
    autofocus: props.autofocus,
    theme: theme === 'dark' ? 'dark' : 'light',
    usageStatistics: false,
    events: {
      change: () => emitMarkdown(),
      blur: () => handleEditorBlur(),
      focus: () => handleEditorFocus(),
    },
  })
  applyEditorTheme(theme)
  if (props.disabled) {
    editor.blur()
  }
}

function destroyEditor() {
  if (editor) {
    editor.destroy()
    editor = null
  }
}

function focus() {
  editor?.focus()
}

function getMarkdown(): string {
  return editor?.getMarkdown() ?? props.modelValue ?? ''
}

watch(
  () => props.modelValue,
  (next) => {
    if (!editor) return
    const current = editor.getMarkdown()
    if (next === current) return
    syncingFromProp = true
    editor.setMarkdown(next ?? '', false)
    syncingFromProp = false
  },
)

watch(
  () => props.height,
  (h) => {
    if (editor && h) editor.setHeight(h)
  },
)

watch(
  () => props.disabled,
  (disabled) => {
    if (!editor) return
    if (disabled) editor.blur()
  },
)

onMounted(async () => {
  await nextTick()
  await createEditor()
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    themeObserver = new MutationObserver(() => {
      if (!editor) return
      applyEditorTheme(readDocumentTheme())
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
  }
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
  destroyEditor()
})

defineExpose({ focus, getMarkdown })

const rootClass = computed(() => ({
  'md-text-editor': true,
  'md-text-editor--disabled': props.disabled,
}))
</script>

<template>
  <div :class="rootClass" data-testid="markdown-text-editor">
    <div
      ref="rootEl"
      class="md-text-editor__host"
      @focusin="onEditorFocusIn"
      @focusout="handleEditorBlur"
    />
  </div>
</template>

<style scoped lang="scss">
.md-text-editor {
  width: 100%;
  min-height: 0;
}

.md-text-editor--disabled {
  pointer-events: none;
  opacity: 0.65;
}

.md-text-editor__host {
  width: 100%;
}

.md-text-editor :deep(.toastui-editor-defaultUI) {
  border-radius: 6px;
}

// xem docs/architecture/code/frontend.md §6
.md-text-editor :deep(.auto-height) {
  .ProseMirror {
    overflow: visible !important;
    height: auto !important;
  }

  .toastui-editor-md-container .toastui-editor-md-preview {
    overflow: visible !important;
    height: auto !important;
  }

  .toastui-editor-ww-container .toastui-editor-contents {
    overflow: visible !important;
    height: auto !important;
  }
}
</style>
