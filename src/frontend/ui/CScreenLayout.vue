<script setup lang="ts">
import { computed, useSlots } from 'vue'

/** Tab shown in the top navigation bar — hidden automatically when there's only one. */
export type CScreenLayoutTab = { key: string; label: string }

const props = withDefaults(
  defineProps<{
    tabs?: CScreenLayoutTab[]
    activeTabKey?: string
    tabsAriaLabel?: string
    /** No-op when the `left` slot isn't used. */
    subSidebarCollapsed?: boolean
    /** Collapse `main` away entirely so `left` takes the full width. */
    hideMain?: boolean
    /** Canvas content (e.g. VueFlow) needs `hidden` to avoid a double scrollbar. */
    mainOverflow?: 'auto' | 'hidden'
  }>(),
  {
    tabs: () => [],
    activeTabKey: '',
    tabsAriaLabel: '',
    subSidebarCollapsed: false,
    hideMain: false,
    mainOverflow: 'auto',
  },
)

const emit = defineEmits<{ 'update:activeTabKey': [key: string] }>()

const slots = useSlots()

const hasLeft = computed(() => !!slots.left)
/**
 * `--left-collapsed` wins over `hideMain`: with `left` shrunk to a rail there
 * would be nothing left to look at, so `main` comes back to carry the empty
 * state. Resolved here instead of in CSS source order, so the losing modifier
 * is never emitted at all.
 */
const hideMainEffective = computed(
  () => props.hideMain && hasLeft.value && !props.subSidebarCollapsed,
)
const showTop = computed(() => (props.tabs?.length ?? 0) > 1 || !!slots['top-extra'])

function selectTab(key: string) {
  emit('update:activeTabKey', key)
}
</script>

<template>
  <div class="c-screen-layout">
    <div v-if="showTop" class="c-screen-layout__top">
      <div
        v-if="(tabs?.length ?? 0) > 1"
        class="c-screen-layout__tabs"
        role="tablist"
        :aria-label="tabsAriaLabel || undefined"
      >
        <button
          v-for="tb in tabs"
          :key="tb.key"
          type="button"
          role="tab"
          class="c-screen-layout__tab"
          :class="{ active: tb.key === activeTabKey }"
          :aria-selected="tb.key === activeTabKey"
          @click="selectTab(tb.key)"
        >{{ tb.label }}</button>
      </div>
      <slot name="top-extra" />
    </div>

    <div
      class="c-screen-layout__body"
      :class="{
        'c-screen-layout__body--no-left': !hasLeft,
        'c-screen-layout__body--left-collapsed': hasLeft && subSidebarCollapsed,
        'c-screen-layout__body--no-main': hideMainEffective,
      }"
    >
      <div v-if="hasLeft" class="c-screen-layout__left"><slot name="left" /></div>
      <div class="c-screen-layout__main" :style="{ overflow: mainOverflow }"><slot name="main" /></div>
    </div>
  </div>
</template>

<style scoped>
.c-screen-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.c-screen-layout__top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.c-screen-layout__tabs {
  display: inline-flex;
  gap: 2px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
}

.c-screen-layout__tab {
  background: none;
  border: none;
  color: var(--muted);
  padding: 4px 14px;
  font-size: 12px;
  font-family: inherit;
  border-radius: 4px;
  cursor: pointer;
}
.c-screen-layout__tab:hover:not(.active) { color: var(--text); }
.c-screen-layout__tab.active {
  background: var(--panel);
  color: var(--accent);
  font-weight: 600;
}

.c-screen-layout__body {
  display: grid;
  grid-template-columns: 240px 1fr;
  flex: 1;
  overflow: hidden;
  isolation: isolate;
  transition: grid-template-columns 0.2s ease;
}
.c-screen-layout__body--left-collapsed {
  grid-template-columns: 48px 1fr;
}
.c-screen-layout__body--no-left {
  grid-template-columns: 1fr;
}
/* `1fr 0`, not the single-column `1fr` of `--no-left`: `main` is always
   rendered, so a one-track grid would wrap it onto a second row instead of
   hiding it. Zero width + main's own overflow clips it, and the shared grid
   transition still animates the collapse. */
.c-screen-layout__body--no-main {
  grid-template-columns: 1fr 0;
}

.c-screen-layout__left {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--panel);
  border-right: 1px solid var(--border);
  min-width: 0;
}

.c-screen-layout__main {
  min-width: 0;
  height: 100%;
}
</style>
