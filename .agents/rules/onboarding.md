---
trigger: always_on
---

# Agent Onboarding Protocol

## 1. Read Core Rules

- `.agents/rules/guardrails.md`
- `.agents/rules/coding-standards.md`
- `.agents/rules/security-standards.md`
- `.agents/rules/project-structure.md`
- `.agents/rules/tech-stack.md`
- `.agents/rules/issue-creation-standards.md`
- `.agents/rules/issue-execution.md`
- `.agents/rules/pr-code-review-address-guidelines.md`

## 2. Read Project Context

- `AGENTS.md` for Next.js version caution notes.
- `README.md` for setup, scripts, and feature conventions.
- `DEPLOYMENT.md` when release or production tasks are involved.

## 3. Working Directives

- Respect strict TypeScript and existing architecture.
- Prefer editing existing modules over introducing new structural patterns.
- Run the appropriate checks (`pnpm lint`, the available test command if present, and `pnpm build` for release-sensitive changes).
