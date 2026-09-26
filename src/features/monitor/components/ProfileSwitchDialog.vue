<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { ref, onMounted, watch } from 'vue'
import { fetchPipelineProfiles, fetchPipelineProfile } from '../../pipeline-editor/scripts/ProfileManagerApi'
import { writePipelineConfig } from '../../pipeline-editor/scripts/pipelineEditorApi'

const { t } = useI18nHelpers()

const props = defineProps<{ taskId: string; projectId: string | null; hitlPending: boolean }>()
const emit = defineEmits(['close', 'applied'])

const profiles = ref<{ name: string }[]>([])
const selected = ref('')
const previewFirstStep = ref<string | null>(null)
const loadedPipeline = ref<unknown>(null)
const busy = ref(false)
const error = ref('')

onMounted(async () => {
  try {
    const data = await fetchPipelineProfiles(props.projectId ?? undefined)
    profiles.value = data.profiles ?? []
  } catch (e: any) {
    error.value = String(e.message || e)
  }
})

watch(selected, async (name) => {
  previewFirstStep.value = null
  loadedPipeline.value = null
  if (!name) return
  try {
    const data = await fetchPipelineProfile(name, props.projectId ?? undefined)
    loadedPipeline.value = data.pipeline
    const first = data.pipeline?.steps?.[0]
    previewFirstStep.value = first?.label || first?.id || null
  } catch (e: any) {
    error.value = String(e.message || e)
  }
})

async function apply() {
  if (!selected.value || !loadedPipeline.value) return
  busy.value = true
  error.value = ''
  try {
    await writePipelineConfig('task', loadedPipeline.value, props.taskId, props.projectId ?? undefined)
    emit('applied')
  } catch (e: any) {
    error.value = e?.status === 400 ? t('monitor.pipeline.switchProfileDialog.writeBlocked') : String(e.message || e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div class="modal" role="dialog" aria-modal="true" :aria-label="t('monitor.pipeline.switchProfileDialog.heading')">
        <div class="modal-head">
          <span>{{ t('monitor.pipeline.switchProfileDialog.heading') }}</span>
          <button type="button" class="modal-close" @click="emit('close')">✕</button>
        </div>
        <div class="modal-body">
          <p v-if="!profiles.length" class="modal-hint">
            {{ t('monitor.pipeline.switchProfileDialog.noProfiles') }}
          </p>
          <label v-else class="cfg-label">
            {{ t('monitor.pipeline.switchProfileDialog.selectLabel') }}
            <select v-model="selected" class="cfg-input">
              <option value=""></option>
              <option v-for="p in profiles" :key="p.name" :value="p.name">{{ p.name }}</option>
            </select>
          </label>
          <p v-if="previewFirstStep" class="muted">
            {{ t('monitor.pipeline.switchProfileDialog.firstStep', { step: previewFirstStep }) }}
          </p>
          <p v-if="props.hitlPending && selected" class="editor-error">
            {{ t('monitor.pipeline.switchProfileDialog.hitlWarning') }}
          </p>
          <p v-if="error" class="editor-error">{{ error }}</p>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn-ghost" :disabled="busy" @click="emit('close')">
            {{ t('monitor.pipeline.cancel') }}
          </button>
          <button type="button" class="btn-primary" :disabled="!selected || busy" @click="apply">
            {{ busy ? t('monitor.pipeline.saving') : t('monitor.pipeline.switchProfileDialog.apply') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.editor-error { color: var(--danger); font-size: 12px; margin: 0; }
.modal-body { display: flex; flex-direction: column; gap: 10px; }
</style>
