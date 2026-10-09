<script setup lang="ts">
import { computed, onMounted, onUnmounted, useId } from 'vue'
import CLoadingOverlay from './CLoadingOverlay.vue'
import Icon from './Icon.vue'
import { useDialogStack } from '../composables/useDialogStack'
import { useI18nHelpers } from '../composables/useI18nHelpers'

/** Dialog modal dùng chung — xem docs/agent-rules/ui-design-guideline.md §3. */
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    title?: string
    /** Nhãn nút ✕; mặc định `common.dialog.close`. */
    closeLabel?: string
    /** Bật `CLoadingOverlay` phủ vùng body. */
    loading?: boolean
    loadingLabel?: string
    closeOnEscape?: boolean
    /** Chặn cả ba đường đóng: ✕, Escape, click backdrop. */
    closeDisabled?: boolean
    /** Giá trị CSS, ghi đè kích thước mặc định của `.modal`. */
    width?: string
    height?: string
    minHeight?: string
    maxHeight?: string
    resizable?: boolean
  }>(),
  {
    title: '',
    closeLabel: '',
    loading: false,
    loadingLabel: '',
    closeOnEscape: true,
    closeDisabled: false,
    resizable: false,
  },
)

const emit = defineEmits<{ close: [] }>()

const { t } = useI18nHelpers()
const { isTop } = useDialogStack()
const titleId = useId()

const closeText = computed(() => props.closeLabel || t('common.dialog.close'))
const sizeStyle = computed(() => ({
  width: props.width,
  height: props.height,
  minHeight: props.minHeight,
  maxHeight: props.maxHeight,
}))

function requestClose() {
  if (props.closeDisabled) return
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || !isTop()) return
  if (!props.closeOnEscape) return
  requestClose()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="requestClose">
      <div
        v-bind="$attrs"
        class="modal c-dialog"
        :class="{ 'c-dialog--resizable': resizable }"
        :style="sizeStyle"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <div class="modal-head">
          <h3 :id="titleId" class="c-dialog-title">
            <slot name="title">{{ title }}</slot>
          </h3>
          <slot name="head" />
          <button
            type="button"
            class="modal-close"
            :title="closeText"
            :aria-label="closeText"
            :disabled="closeDisabled"
            @click="requestClose"
          >
            <Icon name="close" :size="14" />
          </button>
        </div>

        <slot name="subhead" />

        <div class="c-loading-host">
          <CLoadingOverlay :active="loading" :label="loadingLabel" />
          <div class="modal-body c-dialog-body">
            <slot />
          </div>
        </div>

        <slot name="footer" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.c-dialog-title {
  margin: 0;
  font: inherit;
  min-width: 0;
  overflow-wrap: anywhere;
}

.c-dialog-body {
  display: flex;
  flex-direction: column;
}

.c-dialog--resizable {
  resize: both;
  overflow: hidden;
  min-width: 320px;
  min-height: 260px;
  max-width: 96vw;
}

.modal-close {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.modal-close:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
