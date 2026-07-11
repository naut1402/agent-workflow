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
    // No agent_ref on purpose: prompt_template is a fully self-contained,
    // free-form instruction ("rewrite this file in place"). The dev-agent-teams
    // pipeline agents (e.g. doc-reviewer) each have a narrow, fixed role — the
    // doc-reviewer one explicitly refuses to edit the file it reviews and
    // expects `$ARGUMENTS = <task-id> --doc=...` — binding one of them here
    // sends the runner two contradictory instructions and it just asks for
    // clarification instead of doing the edit.
    agent_ref: '',
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
