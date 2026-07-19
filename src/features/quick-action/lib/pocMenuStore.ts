import { ref } from 'vue'
import type { ArtifactMenuNode } from './menuTypes'

/** Shared in-memory menu tree for E0003 UI prototype (replaced by catalog persist later). */
export const pocMenus = ref<ArtifactMenuNode[]>([
  {
    id: 'docs',
    label: 'Tài liệu',
    children: [
      {
        id: 'docs-improve',
        label: 'Cải thiện',
        action_id: 'improve-doc',
      },
      {
        id: 'docs-more',
        label: 'Thêm',
        children: [
          {
            id: 'docs-summarize',
            label: 'Tóm tắt',
            action_id: 'summarize-doc',
          },
        ],
      },
    ],
  },
])
