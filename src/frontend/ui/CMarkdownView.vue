<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18nHelpers } from '../composables/useI18nHelpers'
import { useAppSettings } from '../composables/useAppSettings'
import { resolveArtifactViewMode } from '../configs/appSettings'
import { parseMarkdown, renderMermaid } from '../lib/markdownLib'
import { buildMarkdownBlocks, fenceYaml } from '../lib/markdownBlocks'

/**
 * Viewer markdown dùng chung (agent editor + knowledge) — thuần trình bày,
 * không gọi API: `content` do cha nạp và truyền xuống.
 *
 * `withFrontmatter` chỉ bật cho nguồn đọc nguyên file `.md`; nguồn đã bóc
 * front-matter sẵn mà bật là nuốt mất phần đầu nội dung thật.
 */
const props = withDefaults(
  defineProps<{
    title: string
    content: string
    withFrontmatter?: boolean
    /**
     * Khoá định danh tài liệu — đổi giá trị này là mở lại mọi block.
     *
     * 🚫 Không dùng `title` làm khoá: title của knowledge entry **không** duy
     * nhất (chính vì thế driver mới phải thêm hậu tố cho slug khi trùng), nên
     * chuyển giữa hai entry cùng tên sẽ giữ nguyên trạng thái gập của tài liệu
     * trước. Bỏ trống thì rơi về `title`, đủ cho nguồn có tên duy nhất.
     */
    docKey?: string
  }>(),
  { withFrontmatter: false, docKey: '' },
)

const { t } = useI18nHelpers()
const { settings } = useAppSettings()

// Dùng lại `artifactViewMode` sẵn có thay vì thêm khoá AppSettings riêng.
const blockMode = ref(resolveArtifactViewMode(settings.value) === 'block')
const openBlocks = ref<Set<number>>(new Set())
const viewRoot = ref<HTMLElement | null>(null)

const blocks = computed(() =>
  buildMarkdownBlocks(props.content, { withFrontmatter: props.withFrontmatter }).map((b) => ({
    ...b,
    label:
      b.kind === 'frontmatter'
        ? t('common.markdownView.metadata')
        : b.heading || t('common.markdownView.untitledSection'),
    html: parseMarkdown(b.kind === 'frontmatter' ? fenceYaml(b.source) : b.source),
  })),
)

const fullHtml = computed(() => parseMarkdown(props.content || ''))

const allBlocksOpen = computed(
  () => blocks.value.length > 0 && openBlocks.value.size === blocks.value.length,
)

async function scheduleMermaid() {
  await nextTick()
  await renderMermaid(viewRoot.value)
}

function onBlockToggle(i: number, ev: Event) {
  const el = ev.target as HTMLDetailsElement
  if (el.open) {
    openBlocks.value.add(i)
    scheduleMermaid()
  } else {
    openBlocks.value.delete(i)
  }
  openBlocks.value = new Set(openBlocks.value) // ép reactivity — cùng pattern ArtifactPanel
}

function toggleAllBlocks() {
  if (allBlocksOpen.value) {
    openBlocks.value = new Set()
  } else {
    openBlocks.value = new Set(blocks.value.map((_, i) => i))
    scheduleMermaid()
  }
}

// Đổi tài liệu → mở lại tất cả block: index của tài liệu trước không còn cùng ý nghĩa.
watch(
  () => props.docKey || props.title,
  () => {
    openBlocks.value = new Set(blocks.value.map((_, i) => i))
  },
  { immediate: true },
)

watch([() => props.content, blockMode], () => scheduleMermaid())
</script>

<template>
  <div class="c-md-view">
    <div class="c-md-toolbar">
      <button
        v-if="blockMode && blocks.length"
        type="button"
        class="icon-btn"
        :title="allBlocksOpen ? t('common.markdownView.collapseAll') : t('common.markdownView.expandAll')"
        :aria-label="allBlocksOpen ? t('common.markdownView.collapseAll') : t('common.markdownView.expandAll')"
        @click="toggleAllBlocks"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            :d="allBlocksOpen ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'"
          />
        </svg>
      </button>
      <span class="c-md-title">{{ title }}</span>
      <button
        v-if="blocks.length > 1"
        type="button"
        class="icon-btn"
        :class="{ active: blockMode }"
        :title="blockMode ? t('common.markdownView.toFull') : t('common.markdownView.toBlock')"
        :aria-label="blockMode ? t('common.markdownView.toFull') : t('common.markdownView.toBlock')"
        @click="blockMode = !blockMode"
      >
        <!-- đang ở block mode → icon "toàn văn", bấm là chuyển sang full -->
        <svg v-if="blockMode" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <rect x="3" y="2" width="10" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" />
          <path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
        </svg>
        <svg v-else viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <rect x="2.5" y="2.5" width="11" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" />
          <rect x="2.5" y="9.5" width="11" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>
    </div>

    <div ref="viewRoot" class="c-md-body">
      <div v-if="blockMode" class="block-list">
        <details
          v-for="(block, i) in blocks"
          :key="i"
          class="block-item"
          :data-block-index="i"
          :open="openBlocks.has(i)"
          @toggle="onBlockToggle(i, $event)"
        >
          <summary>{{ block.label }}</summary>
          <!-- eslint-disable-next-line vue/no-v-html -- parseMarkdown đã sanitise -->
          <div class="md block-content" v-html="block.html" />
        </details>
      </div>
      <!-- eslint-disable-next-line vue/no-v-html -- parseMarkdown đã sanitise -->
      <div v-else class="md" v-html="fullHtml" />
    </div>
  </div>
</template>

<style scoped lang="scss">
/* Toolbar cố định, chỉ `.c-md-body` cuộn (docs/ui-overflow.md). */
.c-md-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.c-md-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.c-md-title {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.c-md-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 22px;
}
</style>
