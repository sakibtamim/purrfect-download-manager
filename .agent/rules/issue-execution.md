---
trigger: always_on
---

# Issue Execution Protocol

Follow this protocol when implementing a GitHub issue.

## 1. Discovery

- Fetch issue details before coding:

```bash
gh issue view <ISSUE_NUMBER> --comments
```

- Confirm scope, acceptance criteria, and any unresolved discussion.
- If issue context is missing or contradictory, pause and ask for clarification.

## 2. Implementation Plan

- Map issue scope to concrete files first.
- Keep changes focused; avoid unrelated refactors.
- Reuse existing architecture patterns in:
  - `src/lib/firebase/`
  - `src/components/providers/`
  - `src/store/`
  - `src/types/`

## 3. Validation Rules

- Always run `pnpm lint`.
- Run the available test command for domain logic, calculations, auth/settings, or utilities.
- For deploy-sensitive work, run `pnpm build` or `pnpm predeploy:check`.
- If Firestore rules/indexes are modified, include rule/index verification steps.

## 4. Completion Criteria

Before marking done, ensure:

- Acceptance criteria are explicitly satisfied.
- Any skipped/deferred item is documented with reason and follow-up path.
- Relevant docs are updated when behavior changes (`README.md`, `DEPLOYMENT.md`, dashboard docs).
