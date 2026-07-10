<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useAppSettings } from '../../../shared/composables/useAppSettings'

const emit = defineEmits<{ close: [] }>()

const { load } = useAppSettings()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  load()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div
        class="modal settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
      >
        <div class="modal-head">
          <span id="settings-dialog-title">Cài đặt</span>
          <button
            type="button"
            class="modal-close"
            aria-label="Đóng"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>
        <div class="modal-body">
          <p class="modal-hint">Tuỳ chọn sẽ được bổ sung ở các phiên bản sau.</p>
          <section class="settings-section">
            <h3 class="settings-section-title">Giao diện</h3>
          </section>
          <section class="settings-section">
            <h3 class="settings-section-title">Artifact</h3>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>
