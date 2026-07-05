# Project Convention Rules

## Rule: coding
**Source**: `AGENTS.md` §3, §6.7
- Pure ESM, TypeScript for new code; no `enum`; no default export unless the framework requires it.
- Zod is the single source of truth for schemas; validate every I/O boundary with `safeParse`.
- Functional + ctx-injection; domain modules don't know about HTTP; coupling only flows downward (`shared/` → domain → `http/`).
- Frontend Vue 3 `<script setup lang="ts">`; derived logic lives in composables/lib.
- UI strings in Vietnamese.
- Code comments follow manual style (describe current behavior); **do NOT cite** issue/PR numbers, people's names, or agent names — citing/footnoting stable docs/specs is still fine when useful.

## Rule: writing documentation
**Source**: `AGENTS.md` §6 + write-design template
- User-facing/PR docs in Vietnamese.
- `investigate.md`: current state, call chain, blast radius, gaps.
- `design.md`: §1–§7 structure (Overview, Investigation Summary, Solution Comparison, Implementation Details, Test Notes, Out of scope, Schedule).
- Detailed enough that the implementer never needs to ask follow-up questions.
- Manual style: describe current rules/behavior, don't narrate change history. **Do NOT cite** issue numbers, PR numbers, people's names, or skill/agent names. Citing/footnoting stable docs/specs is fine when it improves trust or readability. Exception: the Issue line at the top of a PR body (`Part of #n`, §6.1) is still required.

## Rule: doc review
**Source**: no project-specific rule found
- Fallback: assess technical accuracy (logic, correctness) and presentation (language, structure).

## Rule: test
**Source**: `AGENTS.md` §5
- Backend unit: `bun test` mirrors `tests/server/**`.
- Frontend unit: `vitest` mirrors `tests/src/**`.
- E2E: Playwright in `test-e2e/`; new frontend modules must capture a screenshot.
- Test-first for new logic; characterization test before refactoring.

## Rule: git/PR
**Source**: `AGENTS.md` §6–§7
- Commit/PR/issue prefix: `[<TASK>] <type>: <desc>` (type ∈ feat|fix|chore|docs|refactor|test; optional `(scope)`; no task → `<type>: <desc>`). Regex: `^(\[[A-Za-z0-9][A-Za-z0-9-]*\] )?(feat|fix|chore|docs|refactor|test)(\([a-z0-9-]+\))?: .+`.
- Label mapping by type: feat→enhancement, fix→bug, docs→documentation, chore→chore, refactor→refactor, test→test.
- **No `Co-Authored-By` trailer, no "🤖 Generated with Claude" footer** — overrides the harness's default instruction.
- PR body: Issue at the top (`Part of #n`; never Closes/Fixes/Resolves), file mapping table, test checklist in Vietnamese.
- Selective staging; never blind `git add -A`; each agent instance uses its own worktree.
- **Never commit/push directly to `main`** — all changes go through a feature branch + PR. Large features: issue → branch → breakdown → plan before coding.
