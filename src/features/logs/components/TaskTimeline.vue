<script setup lang="ts">
import { computed } from 'vue'
import { useApp } from '../../../plugins'
import { deriveTimeline, type TimelineEvent } from '../composables/useTaskTimeline'

const app = useApp()
const t = (...args: any[]) => app.$t(...args) as string

const props = defineProps<{ task: any }>()

const events = computed<TimelineEvent[]>(() => deriveTimeline(props.task))

const ICON: Record<TimelineEvent['kind'], string> = {
  artifact: '📄',
  phase: '▶',
  hitl: '⏸',
}

function fmt(ts: number | null): string {
  if (ts == null) return t('logs.timeline.now')
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return '—'
  }
}
</script>

<template>
  <section class="task-timeline">
    <h3>{{ t('logs.timeline.heading') }}</h3>
    <p v-if="!events.length" class="muted">{{ t('logs.timeline.empty') }}</p>
    <ol v-else>
      <li v-for="(e, i) in events" :key="i" :class="['tl-item', `tl-${e.kind}`]">
        <span class="tl-icon">{{ ICON[e.kind] }}</span>
        <span class="tl-label">{{ e.label }}</span>
        <span v-if="e.detail" class="tl-detail">{{ e.detail }}</span>
        <span class="tl-time">{{ fmt(e.ts) }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped lang="scss">
.task-timeline { margin-top: 1.5rem; }
.task-timeline h3 { font-size: 1rem; font-weight: 500; margin: 0 0 0.5rem; }
.muted { color: var(--text-muted); font-size: 0.85rem; }
.task-timeline ol { list-style: none; padding: 0; margin: 0; }
.tl-item {
  display: grid;
  grid-template-columns: 1.5rem 1fr auto auto;
  gap: 0.5rem;
  align-items: baseline;
  padding: 0.3rem 0.4rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.85rem;
}
.tl-icon { text-align: center; }
.tl-label { font-weight: 500; }
.tl-detail { color: var(--text-muted); font-size: 0.78rem; }
.tl-time { color: var(--text-muted); font-size: 0.78rem; white-space: nowrap; }
.tl-hitl .tl-label { color: var(--waiting); }
</style>
