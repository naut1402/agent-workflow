<script setup lang="ts">
export interface WizardStep {
  key: string
  label: string
}

const props = withDefaults(
  defineProps<{
    steps: WizardStep[]
    /** 1-based index of the active step. */
    current: number
    /**
     * Highest 1-based step the user may jump forward to. Steps beyond this are
     * rendered locked (a gate earlier in the wizard has not been satisfied).
     * Backward navigation is always allowed regardless of this value.
     */
    maxReachable?: number
    /** Lock every step (e.g. the wizard has already been submitted). */
    disabled?: boolean
    ariaLabel?: string
  }>(),
  {
    maxReachable: 1,
    disabled: false,
    ariaLabel: undefined,
  },
)

const emit = defineEmits<{ go: [step: number] }>()

function stateOf(index: number) {
  const n = index + 1
  if (n === props.current) return 'current'
  return n < props.current ? 'done' : 'ahead'
}

/** Backward is always open; forward only up to the last satisfied gate. */
function isNavigable(index: number) {
  const n = index + 1
  if (props.disabled || n === props.current) return false
  return n < props.current || n <= props.maxReachable
}

function onGo(index: number) {
  if (!isNavigable(index)) return
  emit('go', index + 1)
}
</script>

<template>
  <nav class="wizard-stepper" :aria-label="ariaLabel">
    <ol class="wizard-stepper-list">
      <li
        v-for="(s, i) in steps"
        :key="s.key"
        class="wizard-stepper-item"
        :class="`is-${stateOf(i)}`"
        :aria-current="i + 1 === current ? 'step' : undefined"
      >
        <button
          type="button"
          class="wizard-stepper-btn"
          :disabled="!isNavigable(i)"
          @click="onGo(i)"
        >
          <span class="wizard-stepper-dot">{{ i + 1 }}</span>
          <span class="wizard-stepper-label">{{ s.label }}</span>
        </button>
      </li>
    </ol>
  </nav>
</template>

<style scoped lang="scss">
.wizard-stepper-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 2px;
}

.wizard-stepper-item {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
}

/* Connector between steps — drawn on the item, not the button, so the hit area
   stays tight around the label. */
.wizard-stepper-item + .wizard-stepper-item::before {
  content: '';
  flex: 0 0 8px;
  height: 1px;
  background: var(--border);
}

.wizard-stepper-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  padding: 4px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  opacity: 0.6;
}

.wizard-stepper-btn:disabled {
  cursor: default;
}

.wizard-stepper-btn:not(:disabled):hover {
  background: var(--panel-2);
  opacity: 0.9;
}

.wizard-stepper-dot {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--border);
  font-size: 11px;
  line-height: 1;
}

.wizard-stepper-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.is-current .wizard-stepper-btn {
  opacity: 1;
  color: var(--accent);
}

.is-current .wizard-stepper-dot {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.15);
}

.is-done .wizard-stepper-btn {
  opacity: 0.85;
}

.is-done .wizard-stepper-dot {
  border-color: var(--accent);
}
</style>
