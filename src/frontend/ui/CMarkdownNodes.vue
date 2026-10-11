<script setup lang="ts">
import type { RenderedNode } from '../lib/markdownBlocks'

/**
 * Render đệ quy các mục con (`###`…`######`) của một khối thành `<details>` lồng.
 *
 * Tách thành component riêng vì cây là đệ quy — viết `v-for` lồng tay sẽ phải
 * chép ở cả hai viewer và vẫn chỉ phủ được số tầng cố định. Component tự gọi
 * chính nó qua tên file (`<script setup>` cho phép đệ quy như vậy).
 *
 * 🚫 Component này KHÔNG parse markdown. HTML được dựng sẵn ở computed của
 * viewer (`renderNodes`) rồi truyền xuống dạng `node.html`. Gọi `parseMarkdown`
 * ngay trong template sẽ khiến mỗi lần gập/mở một mục con parse lại toàn bộ
 * cây, vì render function nào cũng đọc `isOpen(...)` nên cùng phụ thuộc
 * `openNodes`.
 */
defineProps<{
  nodes: RenderedNode[]
  /** Path của node cha — `'<blockIndex>'` ở tầng đầu. */
  path: string
  isOpen: (path: string) => boolean
  onToggle: (path: string, ev: Event) => void
}>()
</script>

<template>
  <details
    v-for="(node, i) in nodes"
    :key="i"
    class="block-sub"
    :class="`block-sub--h${node.level}`"
    :data-node-path="`${path}/${i}`"
    :open="isOpen(`${path}/${i}`)"
    @toggle="onToggle(`${path}/${i}`, $event)"
  >
    <summary>{{ node.heading }}</summary>
    <div class="block-sub__body">
      <!-- eslint-disable-next-line vue/no-v-html -- `html` dựng từ parseMarkdown, đã sanitise -->
      <div class="md" v-html="node.html" />
      <CMarkdownNodes
        v-if="node.children.length"
        :nodes="node.children"
        :path="`${path}/${i}`"
        :is-open="isOpen"
        :on-toggle="onToggle"
      />
    </div>
  </details>
</template>
