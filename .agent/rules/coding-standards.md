---
trigger: always_on
---

# Coding Standards

## 1. Safety First

- Verify file paths with workspace tools (`list_dir`, `file_search`) before editing.
- Do not add or upgrade dependencies without explicit user approval.
- When dependencies change, run `pnpm audit` and do not introduce high/critical vulnerabilities.
- Keep commits focused by concern (code, config, docs).

## 2. TypeScript and React

- Follow strict TypeScript patterns. Avoid `any` unless there is no practical alternative.
- Prefer explicit types for component props, store state, and helper return values.
- Keep React components small and composable.
- Use memoization (`useMemo`, `useCallback`) only when it prevents meaningful re-render cost.

## 3. Project Conventions

- Keep Firebase data-access logic in `src/lib/firebase/`.
- Keep reusable app logic in `src/lib/` and state management in `src/store/`.
- Co-locate tests next to domain utilities where practical (for example `*.test.ts`).

## 4. Verification and Docs

- Run `pnpm lint` for code-quality validation.
- Run the available test command when behavior or business logic changes, or note that no dedicated test suite exists yet.
- Keep docs in sync when behavior changes (`README.md`, `DEPLOYMENT.md`, dashboard QA/style docs).
