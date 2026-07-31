import type { ArtifactAction } from '../../../../core/contracts/schemas/artifactAction.js'

// Built-in default catalog, used when the dashboard-global
// `artifact-actions.yaml` (under `~/.dev-team-dashboard/`) is missing. Kept as a
// self-contained literal for the same reason as DEFAULT_PIPELINE — the viewer is
// copied out of the plugin tree and can't read a bundled asset at runtime. A
// valid global YAML fully replaces this list (declarative override).
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
      'Cải thiện độ rõ ràng, cấu trúc câu và văn phong tiếng Việt, giữ nguyên ý',
      'nghĩa, thuật ngữ và định dạng markdown.',
      '- Nếu có ĐOẠN TRÍCH ở cuối prompt: chỉ cải thiện đúng đoạn đó.',
      '- Nếu không có đoạn trích: đọc file {{artifact_name}} trong thư mục task',
      '  hiện tại và cải thiện toàn bộ nội dung.',
      'CHỈ IN RA (stdout) nội dung đã cải thiện — không giải thích, không bọc trong',
      'dấu ``` , không thêm gì khác. Không cần ghi file.',
      '',
      'Đoạn trích cần cải thiện (nếu có):',
      '{{selection}}',
    ].join('\n'),
    produces: [],
    confirm: true,
    // Runs on both the title toolbar (whole document) and the selection toolbar.
    // The agent RESPONDS with the improved text (stdout); the server captures
    // that as the proposed content. For a selection run it is spliced back into
    // only the selected line range so no other line changes — the user reviews
    // the diff before it's applied (see jobQueue approval flow).
    attach_points: ['artifact-title', 'artifact-selection'],
    // Never writes straight to the real file: the agent edits a scratch copy and
    // the user reviews the diff before it's applied (see jobQueue approval flow).
    require_approval: true,
  },
]
