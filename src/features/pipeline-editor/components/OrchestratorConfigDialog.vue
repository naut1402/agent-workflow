<script setup lang="ts">
import { useI18nHelpers } from '../../../frontend/composables/useI18nHelpers'
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import KnowledgePickerDialog from '../../../frontend/ui/KnowledgePickerDialog.vue'

const props = defineProps({
  orchestrator: { type: Object as () => Record<string, unknown> | null, default: null },
  projectId: { type: String, default: null },
})

const emit = defineEmits(['update', 'close'])

const { t } = useI18nHelpers()

const showKnowledgePicker = ref(false)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && !showKnowledgePicker.value) emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => window.removeEventListener('keydown', onKeydown))

const draft = ref({ system_prompt: '', knowledge_inputs: [] as string[] })

watch(
  () => props.orchestrator,
  (o) => {
    draft.value = {
      system_prompt: (o?.system_prompt as string) ?? '',
      knowledge_inputs: Array.isArray(o?.knowledge_inputs) ? [...(o.knowledge_inputs as string[])] : [],
    }
  },
  { immediate: true },
)

const knowledgeInputs = computed({
  get: () => draft.value.knowledge_inputs,
  set: (ids: string[]) => {
    draft.value.knowledge_inputs = ids
  },
})

function removeKnowledgeInput(i: number) {
  draft.value.knowledge_inputs.splice(i, 1)
}

function apply() {
  emit('update', {
    system_prompt: draft.value.system_prompt,
    knowledge_inputs: draft.value.knowledge_inputs,
  })
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div
        class="modal orchestrator-config-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('pipelineEditor.orchestrator.editTitle')"
      >
        <div class="modal-head">
          <span>{{ t('pipelineEditor.orchestrator.editTitle') }}</span>
          <button
            type="button"
            class="modal-close"
            :aria-label="t('pipelineEditor.stepConfig.close')"
            @click="emit('close')"
          >✕</button>
        </div>

        <div class="modal-body orchestrator-config-dialog-body">
          <label class="cfg-label">
            {{ t('pipelineEditor.orchestrator.systemPromptLabel') }}
            <textarea
              v-model="draft.system_prompt"
              class="cfg-input cfg-textarea"
              rows="6"
              :placeholder="t('pipelineEditor.orchestrator.systemPromptPlaceholder')"
            />
          </label>

          <label class="cfg-label">
            {{ t('pipelineEditor.orchestrator.knowledgeLabel') }}
            <div class="tag-row">
              <span
                v-for="(kid, i) in draft.knowledge_inputs"
                :key="kid"
                class="chip chip-rm"
                @click="removeKnowledgeInput(i)"
              >{{ kid }} ✕</span>
            </div>
            <div class="tag-input-row">
              <button type="button" class="btn-ghost btn-sm" @click="showKnowledgePicker = true">
                {{ t('pipelineEditor.stepConfig.knowledgePick') }}
              </button>
            </div>
          </label>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-ghost" @click="emit('close')">
            {{ t('pipelineEditor.stepConfig.cancel') }}
          </button>
          <button type="button" class="btn-primary" @click="apply">
            {{ t('pipelineEditor.stepConfig.apply') }}
          </button>
        </div>
      </div>
    </div>

    <KnowledgePickerDialog
      v-if="showKnowledgePicker"
      v-model="knowledgeInputs"
      :project-id="projectId"
      @close="showKnowledgePicker = false"
    />
  </Teleport>
</template>

<style scoped lang="scss">
.orchestrator-config-dialog { width: min(520px, 94vw); }

.orchestrator-config-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cfg-textarea {
  resize: vertical;
  font-family: inherit;
}
</style>
