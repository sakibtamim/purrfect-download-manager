---
trigger: always_on
---

# Project Structure Map

This repository is a single Next.js App Router project.

## Root

- `src/app/`: Routes, layouts, and page-level UI.
- `src/components/`: Reusable React components.
  - `auth/`: Auth-facing components.
  - `dashboard/`: Dashboard-specific components.
  - `layout/`: Shared shell/navigation components.
  - `providers/`: App-level providers for auth/settings/finance.
  - `ui/`: Reusable design primitives.
- `src/lib/`: Shared logic and helpers.
  - `firebase/`: Firebase auth, settings, and finance data services.
  - `dashboard/`: Dashboard view utilities.
- `src/store/`: Zustand state stores.
- `src/types/`: Shared TypeScript domain types.

## Config and Ops

- Firebase config and rules live at root (`firebase.json`, `firestore.rules`, `firestore.indexes.json`).
- Build/lint/test/deploy scripts are defined in `package.json`.
- Product and QA docs live at root (`README.md`, `DEPLOYMENT.md`, dashboard checklists).

## Navigation Tips

- Use `@/` alias for imports rooted at `src/`.
- Prefer extending existing domain folders over creating parallel new structures.
