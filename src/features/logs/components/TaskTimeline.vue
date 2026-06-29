<script setup lang="ts">
import { computed } from 'vue'
import { deriveTimeline, type TimelineEvent } from '../composables/useTaskTimeline'

const props = defineProps<{ task: any }>()

const events = computed<TimelineEvent[]>(() => deriveTimeline(props.task))

const ICON: Record<TimelineEvent['kind'], string> = {
  artifact: '📄',
  phase: '▶',
  hitl: '⏸',
}

function fmt(ts: number | null): string {
  if (ts == null) return 'hiện tại'
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return '—'
  }
}
</script>

<template>
  <section class="task-timeline">
    <h3>Dòng thời gian hoạt động</h3>
    <p v-if="!events.length" class="muted">Chưa có hoạt động nào.</p>
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

<style scoped>
.task-timeline { margin-top: 1.5rem; }
.task-timeline h3 { font-size: 1rem; font-weight: 500; margin: 0 0 0.5rem; }
.muted { color: var(--text-muted, #666); font-size: 0.85rem; }
.task-timeline ol { list-style: none; padding: 0; margin: 0; }
.tl-item {
  display: grid;
  grid-template-columns: 1.5rem 1fr auto auto;
  gap: 0.5rem;
  align-items: baseline;
  padding: 0.3rem 0.4rem;
  border-bottom: 1px solid #eee;
  font-size: 0.85rem;
}
.tl-icon { text-align: center; }
.tl-label { font-weight: 500; }
.tl-detail { color: var(--text-muted, #666); font-size: 0.78rem; }
.tl-time { color: var(--text-muted, #888); font-size: 0.78rem; white-space: nowrap; }
.tl-hitl .tl-label { color: #b8860b; }
</style>
