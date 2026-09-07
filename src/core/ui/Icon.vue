<script setup lang="ts">
/**
 * Shared action/status icon set — extends the `RailIcon.vue` pattern (name-prop +
 * switch/case inline SVG) beyond the sidebar rail. Each icon keeps the viewBox and
 * fill-or-stroke treatment of whichever original hand-drawn SVG it replaces, so no
 * path was redrawn when an icon moved here.
 */
type IconName =
  | 'chatBubble'
  | 'close'
  | 'bell'
  | 'archiveBox'
  | 'trash'
  | 'plus'
  | 'pencil'
  | 'copy'
  | 'save'
  | 'star'
  | 'layout'
  | 'play'
  | 'stop'
  | 'chevronLeft'
  | 'chevronRight'
  | 'paperclip'

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 16 })

const VIEW_BOX: Record<IconName, string> = {
  chatBubble: '0 0 24 24',
  close: '0 0 16 16',
  bell: '0 0 16 16',
  archiveBox: '0 0 16 16',
  trash: '0 0 16 16',
  plus: '0 0 16 16',
  pencil: '0 0 16 16',
  copy: '0 0 16 16',
  save: '0 0 16 16',
  star: '0 0 16 16',
  layout: '0 0 16 16',
  play: '0 0 16 16',
  stop: '0 0 16 16',
  chevronLeft: '0 0 16 16',
  chevronRight: '0 0 16 16',
  paperclip: '0 0 16 16',
}

const viewBox = VIEW_BOX[props.name]
</script>

<template>
  <svg :width="size" :height="size" :viewBox="viewBox" aria-hidden="true">
    <template v-if="name === 'chatBubble'">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M20.5 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 20.5 12z"
      />
      <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M8.5 10.5h7M8.5 13.5h4.5" />
    </template>
    <template v-else-if="name === 'close'">
      <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M4 4l8 8M12 4l-8 8" />
    </template>
    <template v-else-if="name === 'bell'">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M8 2.5c-2 0-3.2 1.5-3.2 3.6v1.8L3.5 10.6h9l-1.3-2.7V6.1C11.2 4 10 2.5 8 2.5z"
      />
      <path fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" d="M6.7 12.2a1.3 1.3 0 0 0 2.6 0" />
    </template>
    <template v-else-if="name === 'archiveBox'">
      <rect x="2" y="2" width="12" height="3" rx="1" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M3 5v7.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5"
      />
      <path fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" d="M6.5 8.5h3" />
    </template>
    <template v-else-if="name === 'trash'">
      <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M3.5 5h9M6 5V3.5h4V5M5 5l.5 8h5L11 5" />
    </template>
    <template v-else-if="name === 'plus'">
      <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M8 3v10M3 8h10" />
    </template>
    <template v-else-if="name === 'pencil'">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M9.5 3.5l3 3L5 14H2v-3L9.5 3.5zM8 5l3 3"
      />
    </template>
    <template v-else-if="name === 'copy'">
      <rect x="5.5" y="5.5" width="7" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M3.5 10.5V3.5h7" />
    </template>
    <template v-else-if="name === 'save'">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M2.5 3.5a1 1 0 0 1 1-1h7L13.5 5.5v7a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9zM5 2.5v3.5h5V2.5M5 13.5V9.5h6v4"
      />
    </template>
    <template v-else-if="name === 'star'">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
        d="M8 2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2 4.4 13.1l.7-4L2.2 6.3l4-.6L8 2z"
      />
    </template>
    <template v-else-if="name === 'layout'">
      <rect x="2" y="4.5" width="4.5" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" />
      <rect x="9.5" y="4.5" width="4.5" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" />
      <path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M6.5 8h3" />
    </template>
    <template v-else-if="name === 'play'">
      <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M5 3.2l7 4.8-7 4.8V3.2z" />
    </template>
    <template v-else-if="name === 'stop'">
      <rect x="4" y="4" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" />
    </template>
    <template v-else-if="name === 'chevronLeft'">
      <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M10 3.5L5.5 8l4.5 4.5" />
    </template>
    <template v-else-if="name === 'chevronRight'">
      <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M6 3.5L10.5 8 6 12.5" />
    </template>
    <template v-else-if="name === 'paperclip'">
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M11.5 7.5l-4.2 4.2a2.4 2.4 0 0 1-3.4-3.4l5-5a1.7 1.7 0 0 1 2.4 2.4l-5 5a.9.9 0 0 1-1.3-1.3l4.2-4.2"
      />
    </template>
  </svg>
</template>
