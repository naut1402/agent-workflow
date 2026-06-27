<script setup>
defineProps({
  name: {
    type: String,
    required: true,
    validator: (v) => ['panelCollapse', 'panelExpand', 'monitor', 'pipeline', 'catalog', 'rules', 'agent', 'knowledge', 'runner'].includes(v),
  },
  size: { type: Number, default: 16 },
})
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
    <template v-else-if="name === 'knowledge'">
      <path d="M3 2.5h10v11H3z" />
      <path d="M5 5.5h6M5 8h6M5 10.5h4" />
      <path d="M11 12.5l2 2" />
    </template>
    <template v-else-if="name === 'runner'">
      <path d="M2 8h3l2-4 4 8 2-4h3" />
      <circle cx="8" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </template>
  </svg>
</template>
