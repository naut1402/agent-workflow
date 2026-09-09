<script setup lang="ts">
import { useI18nHelpers } from '../../../core/composables/useI18nHelpers'
defineProps({
  saving: { type: Boolean, default: false },
  saved: { type: Boolean, default: false },
})

const { t } = useI18nHelpers()
</script>

<template>
  <span
    v-if="saving"
    class="md-save-indicator saving"
    aria-live="polite"
    :title="t('monitor.saveIndicator.saving')"
  >⋯</span>
  <span
    v-else-if="saved"
    class="md-save-indicator saved"
    aria-live="polite"
    :title="t('monitor.saveIndicator.saved')"
  >
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.2 11.2 3.4 8.4l-.9.9 3.7 3.7 7.4-7.4-.9-.9z"
      />
    </svg>
  </span>
</template>
