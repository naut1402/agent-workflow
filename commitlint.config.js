// Commitlint — khớp docs/implement/pr-docs-convention.md §6.
// Format: `[<TASK>]? <type>(<scope>)?: <subject>`
// Type: feat | fix | chore | docs | refactor | test
// Breaking: `type!:` / `type(scope)!:` hoặc footer `BREAKING CHANGE:`

/** @type {import('@commitlint/types').UserConfig} */
const config = {
  // Bỏ qua merge / fixup / squash commit mặc định khi lint range.
  defaultIgnores: true,
  parserPreset: {
    parserOpts: {
      headerPattern:
        /^(?:\[([A-Za-z0-9][A-Za-z0-9-]*)\]\s)?(feat|fix|chore|docs|refactor|test)(?:\(([a-z0-9-]+)\))?(!)?:\s(.+)$/,
      headerCorrespondence: ['ticket', 'type', 'scope', 'breaking', 'subject'],
      // Footer breaking — chuẩn Conventional Commits (cho release tool sau này).
      noteKeywords: ['BREAKING CHANGE', 'BREAKING-CHANGE'],
    },
  },
  rules: {
    'type-empty': [2, 'never'],
    'type-enum': [2, 'always', ['feat', 'fix', 'chore', 'docs', 'refactor', 'test']],
    'scope-case': [2, 'always', 'kebab-case'],
    'subject-empty': [2, 'never'],
    // Subject tiếng Việt / mixed case — không siết sentence-case.
    'subject-case': [0],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 120],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
  },
  helpUrl:
    'https://github.com/naut1402/agent-workflow/blob/dev/1.0.0/main/docs/implement/pr-docs-convention.md#6-commit-message-pr-title--issue-title',
}

export default config
