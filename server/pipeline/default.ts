// Last-resort fallback when NO pipeline.yaml exists anywhere (rare: /dev-dashboard
// setup always scaffolds .dev-team-agent/pipeline.yaml). The canonical source of
// the default flow is dev-team-orchestrator/assets/pipeline.default.yaml — this
// JS literal is a self-contained copy because the viewer is copied out of the
// plugin tree into the project and can't read that asset at runtime. Keep the two
// in sync (only the structure matters here; comments live in the YAML).
export const DEFAULT_PIPELINE: any = {
  version: 1,
  defaults: { review_retry_max: 2, auto_review: false, export_json: false },
  steps: [
    { id: 'investigator', name: 'Investigate', agent: 'dev-agent-teams:investigator', produces: ['investigate.md'], export_key: 'investigator', hitl: { mode: 'manual', gate_id: 'hitl-1', optional_doc_review: true } },
    { id: 'designer', name: 'Design', agent: 'dev-agent-teams:designer', produces: ['design.md'], export_key: 'designer', hitl: { mode: 'manual', gate_id: 'hitl-2', optional_doc_review: true } },
    { id: 'implementer', name: 'Implement', agent: 'dev-agent-teams:implementer', produces: ['phpstan.md'], export_key: 'implementer', hitl: { mode: 'none' } },
    { id: 'reviewer', name: 'Review', agent: 'dev-agent-teams:reviewer', produces: ['review.md', 'test-spec.md'], export_key: 'reviewer', hitl: { mode: 'manual', gate_id: 'hitl-3', blocking: true, retry: { on: 'must_fix', restart_from: 'implementer', max: 2 } } },
    { id: 'pr-creator', name: 'PR', agent: 'dev-agent-teams:pr-creator', produces: ['pr-desc.md'], export_key: 'pr_creator', hitl: { mode: 'none' } },
  ],
  doc_reviewer: { agent: 'dev-agent-teams:doc-reviewer', skills: ['doc-review'], rule_category: 'doc-review', rule_required: true },
}
