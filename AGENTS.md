# Motion Mechanics Agent Guide

This file defines baseline behavior for coding agents working in this repository.

## First Read

Start with these rule files before making changes:

- `.agent/rules/guardrails.md`
- `.agent/rules/coding-standards.md`
- `.agent/rules/security-standards.md`
- `.agent/rules/project-structure.md`
- `.agent/rules/tech-stack.md`
- `.agent/rules/issue-execution.md`

If the task is issue-creation related, also read:

- `.agent/rules/issue-creation-standards.md`

If the task is code-review-feedback related, also read:

- `.agent/rules/pr-code-review-address-guidelines.md`

## Non-Negotiables

- Never commit directly to `develop`.
- Use focused, atomic commits.
- Do not suppress build, lint, or test failures silently.
- Do not edit lockfiles manually.
- Keep documentation and rules in sync with behavioral or workflow changes.

## Repo Shape

This is a single Next.js + Tauri application.

- `src/app`: App Router routes and layouts.
- `src/components`: Shared UI and feature components.
- `src/lib`: Shared helpers and service wrappers.
- `src/store`: Zustand state stores.
- `src-tauri`: Rust backend and Tauri configuration.
- `scripts`: Local maintenance and GitHub automation scripts.

Respect existing feature boundaries and prefer the shared `src/` modules over duplication.

## MCP and Tooling

- This repository does not include an `mcp.json` by default. If your
  environment adds MCP configuration, treat `mcp.json` as the MCP server's
  source of truth and run the corresponding project-specific commands if they
  exist. Do not assume `pnpm mcp:*` scripts are available in `package.json`.

## Working Style

- Prefer strict TypeScript-safe changes.
- Keep changes minimal and local to the task scope.
- Surface assumptions and risks clearly.
- When behavior changes, update docs in the same change.
- The main validation commands are `pnpm lint`, `pnpm build`, `pnpm dev`, `pnpm dev:app`, `pnpm setup`, and `pnpm clean`.
