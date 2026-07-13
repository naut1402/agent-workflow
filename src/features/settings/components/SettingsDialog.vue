<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppSettings } from '../../../shared/composables/useAppSettings'
import { useLocale } from '../../../shared/composables/useLocale'
import {
  resolveArtifactViewMode,
  resolveThemePreference,
  type ThemePreference,
} from '../../../../shared/schemas/appSettings'

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const { settings, load, update } = useAppSettings()
const { locale, setLocale } = useLocale()

const artifactViewMode = computed(() => resolveArtifactViewMode(settings.value))
const theme = computed(() => resolveThemePreference(settings.value))

function setArtifactViewMode(mode: 'block' | 'full') {
  if (artifactViewMode.value === mode) return
  update({ artifactViewMode: mode })
}

function setTheme(mode: ThemePreference) {
  if (theme.value === mode) return
  update({ theme: mode })
}

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
          <section class="settings-section">
            <h3 class="settings-section-title">Giao diện</h3>
            <p class="settings-section-desc">Chọn giao diện sáng, tối, hoặc theo hệ thống.</p>
            <div
              class="settings-radio-group"
              role="radiogroup"
              aria-label="Giao diện"
            >
              <label class="settings-radio">
                <input
                  type="radio"
                  name="theme"
                  value="system"
                  :checked="theme === 'system'"
                  @change="setTheme('system')"
                />
                Hệ thống
              </label>
              <label class="settings-radio">
                <input
                  type="radio"
                  name="theme"
                  value="light"
                  :checked="theme === 'light'"
                  @change="setTheme('light')"
                />
                Sáng
              </label>
              <label class="settings-radio">
                <input
                  type="radio"
                  name="theme"
                  value="dark"
                  :checked="theme === 'dark'"
                  @change="setTheme('dark')"
                />
                Tối
              </label>
            </div>
          </section>
          <section class="settings-section">
            <h3 class="settings-section-title">Artifact</h3>
            <p class="settings-section-desc">Chế độ xem mặc định khi mở tài liệu mới.</p>
            <div
              class="settings-radio-group"
              role="radiogroup"
              aria-label="Chế độ xem artifact mặc định"
            >
              <label class="settings-radio">
                <input
                  type="radio"
                  name="artifactViewMode"
                  value="block"
                  :checked="artifactViewMode === 'block'"
                  @change="setArtifactViewMode('block')"
                />
                Block theo H2
              </label>
              <label class="settings-radio">
                <input
                  type="radio"
                  name="artifactViewMode"
                  value="full"
                  :checked="artifactViewMode === 'full'"
                  @change="setArtifactViewMode('full')"
                />
                Full
              </label>
            </div>
          </section>
          <section class="settings-section">
            <h3 class="settings-section-title">{{ t('common.language.title') }}</h3>
            <p class="settings-section-desc">{{ t('common.language.desc') }}</p>
            <div
              class="settings-radio-group"
              role="radiogroup"
              :aria-label="t('common.language.title')"
            >
              <label class="settings-radio">
                <input
                  type="radio"
                  name="locale"
                  value="vi"
                  :checked="locale === 'vi'"
                  @change="setLocale('vi')"
                />
                {{ t('common.language.vi') }}
              </label>
              <label class="settings-radio">
                <input
                  type="radio"
                  name="locale"
                  value="en"
                  :checked="locale === 'en'"
                  @change="setLocale('en')"
                />
                {{ t('common.language.en') }}
              </label>
            </div>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>
