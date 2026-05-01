---
trigger: always_on
---

# Issue Creation Standards

Use these rules whenever creating or rewriting GitHub issues for this repository.

## 1. Required Sections

Every implementation issue must include these sections in this order:

1. Objective
2. Scope
3. Acceptance Criteria
4. Technical Notes
5. QA Checklist
6. Out of Scope

## 2. Title and Labels

- Write human-readable titles without commit prefixes.
- Apply exactly one type label:
  - `type: feature`
  - `type: bug`
  - `type: enhancement`
  - `type: infra`
  - `type: docs`
- Add one priority label when possible:
  - `priority: P0`, `priority: P1`, `priority: P2`, or `priority: P3`.

## 3. Project-Specific Acceptance Expectations

Acceptance criteria should call out applicable checks from this project:

- `pnpm lint`
- `pnpm test:run` (for logic changes)
- Firestore rules/index updates when data model/security changes
- Dashboard QA checklist validation for dashboard UI changes

## 4. Technical Notes Requirements

Mention concrete touchpoints when known:

- Route/pages in `src/app/`
- Services in `src/lib/firebase/`
- Stores/providers in `src/store/` and `src/components/providers/`
- Types in `src/types/`

## 5. Preferred Creation Command

Use `gh issue create` with labels and full body content. Avoid creating empty placeholder issues unless explicitly requested.
