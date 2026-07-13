// QuickAction module — English messages. Typed against the vi schema, so keys
// must match vi/quickAction.ts exactly. `{'{'}` escapes a literal brace.
export const quickAction = {
  title: 'Quick Action',
  subtitle: 'CRUD the quick actions attached to the artifact viewer (title toolbar / selection toolbar).',
  empty: 'No quick actions yet.',
  directPrompt: '(direct prompt)',
  approvalBadge: '✓ approval',
  approvalBadgeTitle: 'Requires approval before writing',
  actions: {
    edit: 'Edit',
    delete: 'Delete',
  },
  form: {
    newTitle: 'New quick action',
    editTitle: 'Edit "{name}"',
    close: 'Close',
    labelPlaceholder: '✨ Improve document',
    patternsLabel: 'artifact_patterns (comma-separated)',
    agentLabel: 'agent (optional — leave as "direct prompt" to run prompt_template directly, without an agent)',
    agentNone: '(direct prompt — no agent)',
    agentCurrent: '{ref} (current)',
    promptHelpTitleAttr: 'View the list of supported placeholders',
    promptHelpAria: 'View the list of supported placeholders in prompt_template',
    promptPlaceholder:
      "Read {'{'}{'{'}artifact_name{'}'}{'}'} / {'{'}{'{'}artifact_base{'}'}{'}'} / {'{'}{'{'}selection{'}'}{'}'}…",
    runnerLabel: 'runner (optional — defaults to the system default runner)',
    confirmOption: 'Require confirmation before running',
    approvalOption: 'Require approval before writing (view diff)',
    saving: 'Saving…',
    save: 'Save',
    cancel: 'Cancel',
  },
  promptHelp: {
    heading: 'Placeholders supported in prompt_template:',
    selectionNote:
      '(only has a value when the action has the "Text selection" attach point and is run from a selection — empty when run from the title toolbar)',
    writeNote:
      "Note: for an action to actually change a file, the prompt must ask the agent to OVERWRITE the file (using the Write tool) — the runner's stdout is NOT written back to the file.",
    placeholders: {
      artifactName: 'The full artifact file name, e.g. "design.md".',
      artifactBase: 'The artifact file name without its extension, e.g. "design".',
      selection: 'The text the user highlighted in the artifact viewer.',
      selectionLines: 'The line(s) in the source file matching the selected region, e.g. "12" or "12-15".',
    },
  },
  confirm: {
    remove: 'Delete quick action "{label}"?',
  },
  messages: {
    saved: 'Saved "{label}"',
    removed: 'Deleted "{label}"',
  },
  errors: {
    idRequired: 'id must not be empty',
    patternRequired: 'at least 1 artifact pattern is required',
    labelRequired: 'label must not be empty',
    promptRequired: 'prompt_template must not be empty',
    idExists: 'id "{id}" already exists',
    saveFailed: 'Save failed',
  },
}
