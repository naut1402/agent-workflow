<script setup lang="ts">
// Modal directory browser backed by GET /api/fs/browse. Used by ProjectBar
// (add project) and Settings (autoscan whitelist).
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { browseFs } from '../../features/settings/scripts/settingsApi'

const props = defineProps<{
  /** Initial directory to open (absolute). Empty → server default (home). */
  initialPath?: string
}>()

const emit = defineEmits<{
  select: [path: string]
  close: []
}>()

const { t } = useI18n()

const currentPath = ref('')
const parentPath = ref<string | null>(null)
const entries = ref<{ name: string; path: string }[]>([])
const roots = ref(false)
const loading = ref(false)
const errorMsg = ref('')

async function load(dir?: string) {
  loading.value = true
  errorMsg.value = ''
  try {
    const data = await browseFs(dir)
    currentPath.value = data.path || ''
    parentPath.value = data.parent ?? null
    entries.value = Array.isArray(data.entries) ? data.entries : []
    roots.value = Boolean(data.roots)
  } catch (e) {
    errorMsg.value = String((e as Error).message || e)
  } finally {
    loading.value = false
  }
}

function goUp() {
  if (parentPath.value === null) return
  // Empty string sentinel → roots listing
  void load(parentPath.value === '' ? '__roots__' : parentPath.value)
}

function enter(entryPath: string) {
  void load(entryPath)
}

function goRoots() {
  void load('__roots__')
}

function confirmSelect() {
  if (!currentPath.value || roots.value) {
    errorMsg.value = t('common.folderPicker.selectDirRequired')
    return
  }
  emit('select', currentPath.value)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void load(props.initialPath || undefined)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})

watch(
  () => props.initialPath,
  (p) => {
    if (p) void load(p)
  },
)
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop folder-picker-backdrop" @click.self="emit('close')">
      <div
        class="modal folder-picker"
        role="dialog"
        aria-modal="true"
        :aria-label="t('common.folderPicker.title')"
      >
        <div class="modal-head">
          <span>{{ t('common.folderPicker.title') }}</span>
          <button
            type="button"
            class="modal-close"
            :aria-label="t('common.folderPicker.close')"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>
        <div class="modal-body folder-picker-body">
          <div class="folder-picker-toolbar">
            <button
              type="button"
              class="icon-btn"
              :disabled="parentPath === null || loading"
              :title="t('common.folderPicker.up')"
              :aria-label="t('common.folderPicker.up')"
              @click="goUp"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 3.5 2.5 9h3v4h5V9h3L8 3.5z"
                />
              </svg>
            </button>
            <button
              type="button"
              class="icon-btn"
              :disabled="loading"
              :title="t('common.folderPicker.roots')"
              :aria-label="t('common.folderPicker.roots')"
              @click="goRoots"
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M2 3h5l1 1h6v9H2V3zm1 2v7h10V5H3z"
                />
              </svg>
            </button>
            <code class="folder-picker-path" :title="currentPath || t('common.folderPicker.roots')">
              {{ roots ? t('common.folderPicker.roots') : currentPath || '…' }}
            </code>
          </div>

          <ul class="folder-picker-list" :aria-busy="loading">
            <li v-if="loading" class="folder-picker-empty">{{ t('common.folderPicker.loading') }}</li>
            <li v-else-if="!entries.length" class="folder-picker-empty">
              {{ t('common.folderPicker.empty') }}
            </li>
            <li v-for="e in entries" :key="e.path">
              <button type="button" class="folder-picker-item" @click="enter(e.path)">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M2 3h5l1 1h6v9H2V3zm1 2v7h10V5H3z"
                  />
                </svg>
                <span>{{ e.name }}</span>
              </button>
            </li>
          </ul>

          <p v-if="errorMsg" class="folder-picker-err">⚠ {{ errorMsg }}</p>
        </div>
        <div class="modal-actions folder-picker-foot">
          <button type="button" class="btn-ghost" @click="emit('close')">
            {{ t('common.folderPicker.cancel') }}
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="loading || roots || !currentPath"
            @click="confirmSelect"
          >
            {{ t('common.folderPicker.select') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.folder-picker {
  width: min(520px, 94vw);
  max-height: min(640px, 90vh);
  display: flex;
  flex-direction: column;
}

.folder-picker-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  flex: 1;
}

.folder-picker-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.folder-picker-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  opacity: 0.85;
  background: var(--input-surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 5px 8px;
}

.folder-picker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  flex: 1;
  min-height: 220px;
  max-height: 360px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-2, var(--input-surface));
}

.folder-picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 7px 10px;
  font-family: inherit;
  font-size: 13px;
}

.folder-picker-item:hover {
  background: rgba(var(--accent-rgb), 0.12);
}

.folder-picker-empty {
  opacity: 0.55;
  padding: 14px 10px;
  font-size: 13px;
}

.folder-picker-err {
  color: var(--danger);
  font-size: 12px;
  margin: 0;
}

.folder-picker-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
</style>
