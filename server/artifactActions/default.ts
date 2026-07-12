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
      'Bạn đang ở thư mục task. Mở file {{artifact_name}} bằng công cụ đọc file',
      'rồi cải thiện độ rõ ràng, cấu trúc câu và văn phong tiếng Việt của nội dung',
      'trong đó (giữ nguyên ý nghĩa, thuật ngữ và định dạng markdown).',
      'BẮT BUỘC ghi kết quả bằng cách GHI ĐÈ trực tiếp {{artifact_name}} bằng công',
      'cụ Write (stdout KHÔNG được lưu lại vào file). Không in giải thích, không',
      'tạo file mới — chỉ ghi đè {{artifact_name}}.',
    ].join('\n'),
    produces: [],
    confirm: true,
    // Runs on both the title toolbar and the text-selection toolbar. On the
    // title toolbar {{artifact_name}} is the whole document. On the selection
    // toolbar the server hands the agent only the selected lines as a scratch
    // snippet file (as {{artifact_name}}) and splices its result back at the
    // selected line range — so the same "read/improve/overwrite" template
    // improves only the selection without touching any other line.
    attach_points: ['artifact-title', 'artifact-selection'],
    // Never writes straight to the real file: the agent edits a scratch copy and
    // the user reviews the diff before it's applied (see jobQueue approval flow).
    require_approval: true,
  },
]
