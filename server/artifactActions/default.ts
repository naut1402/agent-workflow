import type { ArtifactAction } from '../../shared/schemas/artifactAction.js'

// Built-in default catalog, used when a project has no `artifact-actions.yaml`.
// Mirrors the seed shipped as `.dev-team-agent/artifact-actions.yaml`; kept as a
// self-contained literal for the same reason as DEFAULT_PIPELINE — the viewer is
// copied out of the plugin tree and can't read a bundled asset at runtime. A
// project YAML fully replaces this list (declarative override, no code change).
export const DEFAULT_ARTIFACT_ACTIONS: ArtifactAction[] = [
  {
    id: 'improve-doc',
    label: '✨ Cải thiện tài liệu',
    artifact_patterns: ['investigate.md', 'design.md', 'review.md'],
    agent_ref: 'dev-agent-teams:doc-reviewer',
    prompt_template: [
      'Đọc {{artifact_name}} trong thư mục task hiện tại và cải thiện độ rõ ràng,',
      'cấu trúc và văn phong tiếng Việt của tài liệu.',
      'Ghi đè trực tiếp lên {{artifact_name}}; nếu có điểm cần hỏi (blocking) thì',
      'tạo {{artifact_base}}-improved.md và ghi rõ lý do thay vì ghi đè.',
    ].join('\n'),
    produces: [],
    confirm: true,
    attach_points: ['artifact-title'],
  },
]
