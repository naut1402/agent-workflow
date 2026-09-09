<script setup lang="ts">
import type { RailIconName } from './railIconNames'

withDefaults(
  defineProps<{
    name: RailIconName
    size?: number
  }>(),
  { size: 16 },
)
</script>

<template>
  <svg
    class="rail-icon"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.25"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- Sidebar đang mở → thu gọn -->
    <template v-if="name === 'panelCollapse'">
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M6 2.5v11" />
      <path d="M4 8H5" />
    </template>
    <!-- Sidebar đang thu → mở rộng -->
    <template v-else-if="name === 'panelExpand'">
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M6 2.5v11" />
      <path d="M8 8h3" />
    </template>
    <template v-else-if="name === 'monitor'">
      <rect x="2" y="3" width="12" height="8" rx="1" />
      <path d="M5 14h6" />
      <path d="M8 11v3" />
    </template>
    <template v-else-if="name === 'pipeline'">
      <rect x="2" y="3" width="4" height="4" rx="0.5" />
      <rect x="10" y="3" width="4" height="4" rx="0.5" />
      <rect x="2" y="9" width="4" height="4" rx="0.5" />
      <rect x="10" y="9" width="4" height="4" rx="0.5" />
      <path d="M6 5h4M6 11h4M5 7v2M11 7v2" />
    </template>
    <template v-else-if="name === 'catalog'">
      <path d="M3 3h10v3H3zM3 8h10v5H3z" />
      <path d="M5 4.5h6M5 9.5h6" />
    </template>
    <template v-else-if="name === 'rules'">
      <path d="M5 2h6l2 2v10H5V2z" />
      <path d="M7 6h5M7 8.5h5M7 11h4" />
    </template>
    <template v-else-if="name === 'agent'">
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 14c0-2.5 2.2-4 5-4s5 1.5 5 4" />
      <path d="M12 3.5l1.5 1.5M12 7.5l1.5-1.5" />
    </template>
    <template v-else-if="name === 'skills'">
      <path d="M6 1.5 7.1 4.6 10.2 5.7 7.1 6.8 6 9.9 4.9 6.8 1.8 5.7 4.9 4.6z" />
      <path d="M11.3 8.6 12 10.5 13.9 11.2 12 11.9 11.3 13.8 10.6 11.9 8.7 11.2 10.6 10.5z" />
    </template>
    <template v-else-if="name === 'quickAction'">
      <path d="M9 1.5 3 9h4l-1 5.5 6-8H8l1-5z" />
    </template>
    <template v-else-if="name === 'knowledge'">
      <path d="M3 2.5h10v11H3z" />
      <path d="M5 5.5h6M5 8h6M5 10.5h4" />
      <path d="M11 12.5l2 2" />
    </template>
    <template v-else-if="name === 'runner'">
      <path d="M2 8h3l2-4 4 8 2-4h3" />
      <circle cx="8" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'automations'">
      <circle cx="7" cy="8" r="4.5" />
      <path d="M7 5.5V8l1.8 1.2" />
      <path d="M12.5 9.5l-1.5 2.2h1.8l-1.5 2.2" />
    </template>
    <template v-else-if="name === 'logs'">
      <path d="M3 2.5h10v11H3z" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
    </template>
    <template v-else-if="name === 'statistics'">
      <path d="M3 13.5h10" />
      <path d="M5 13.5V9.5M8 13.5V5.5M11 13.5V7.5" />
    </template>
    <template v-else-if="name === 'settings'">
      <!-- Gear: vòng răng (dasharray tạo 8 răng) + lỗ tâm -->
      <circle cx="8" cy="8" r="5.4" fill="none" stroke-width="2.6" stroke-dasharray="1.9 2.24" />
      <circle cx="8" cy="8" r="2.2" />
    </template>
  </svg>
</template>
