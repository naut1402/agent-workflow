// xem docs/agent-rules/git-pr.md §3
/** @type {import('@commitlint/types').UserConfig} */
const config = {
  defaultIgnores: true,
  parserPreset: {
    parserOpts: {
      headerPattern:
        /^(?:\[([A-Za-z0-9][A-Za-z0-9_-]*)\]\s)?(feat|fix|chore|docs|refactor|test)(?:\(([a-z0-9-]+)\))?(!)?:\s(.+)$/,
      headerCorrespondence: ['ticket', 'type', 'scope', 'breaking', 'subject'],
      noteKeywords: ['BREAKING CHANGE', 'BREAKING-CHANGE'],
    },
  },
  rules: {
    'type-empty': [2, 'never'],
    'type-enum': [2, 'always', ['feat', 'fix', 'chore', 'docs', 'refactor', 'test']],
    'scope-case': [2, 'always', 'kebab-case'],
    'subject-empty': [2, 'never'],
    'subject-case': [0],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 120],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
  },
  helpUrl:
    'https://github.com/naut1402/agent-workflow/blob/main/docs/agent-rules/git-pr.md#7-commit-message-pr-title--issue-title',
}

export default config
