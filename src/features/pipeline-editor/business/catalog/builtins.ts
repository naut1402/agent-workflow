// Built-in fallback catalog when no skills/agents are discovered on disk
// (e.g. marketplace.json not found and no installed plugins).
export const BUILTIN_CATALOG = {
  skills: [
    { id: 'repo:dev-agent-teams:survey-codebase', name: 'survey-codebase', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Survey codebase, trace call chains' },
    { id: 'repo:dev-agent-teams:write-design', name: 'write-design', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Write design documentation' },
    { id: 'repo:dev-agent-teams:coding-rules', name: 'coding-rules', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Apply coding conventions' },
    { id: 'repo:dev-agent-teams:run-phpstan', name: 'run-phpstan', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Run PHPStan static analysis' },
    { id: 'repo:dev-agent-teams:write-tests', name: 'write-tests', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Write test specifications' },
    { id: 'repo:dev-agent-teams:create-pr', name: 'create-pr', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Create pull request' },
    { id: 'repo:dev-agent-teams:doc-review', name: 'doc-review', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Review documentation quality' },
  ],
  agents: [
    { id: 'repo:dev-agent-teams:investigator', name: 'investigator', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Survey codebase, trace call chains from entry point', skills: ['survey-codebase'] },
    { id: 'repo:dev-agent-teams:designer', name: 'designer', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Write design documentation', skills: ['write-design'] },
    { id: 'repo:dev-agent-teams:implementer', name: 'implementer', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Implement code changes, run PHPStan', skills: ['coding-rules', 'run-phpstan'] },
    { id: 'repo:dev-agent-teams:reviewer', name: 'reviewer', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Review code quality, create test spec', skills: ['coding-rules', 'write-tests'] },
    { id: 'repo:dev-agent-teams:pr-creator', name: 'pr-creator', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Create PR description, amend commit', skills: ['create-pr'] },
    { id: 'repo:dev-agent-teams:doc-reviewer', name: 'doc-reviewer', plugin: 'dev-agent-teams', source: 'repo:dev-agent-teams', description: 'Review document quality', skills: ['doc-review'] },
  ],
}
