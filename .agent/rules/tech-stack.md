---
trigger: always_on
---

# Tech Stack and Workflow

## Core Stack

- Framework: Next.js 16 (App Router).
- Language: TypeScript (strict mode).
- UI: React 19 + Tailwind CSS 4 + local UI primitives.
- State: Zustand.
- Backend services: Firebase Auth + Firestore.
- Testing: Vitest.
- Linting: ESLint 9 + `eslint-config-next`.
- Package manager: pnpm.

## Primary Scripts

- `pnpm dev`: Start local development server.
- `pnpm lint`: Run lint checks.
- `pnpm test:run`: Run tests once, if a test runner is configured.
- `pnpm build`: Build production bundle.
- `pnpm predeploy:check`: Lint + tests + build.
- `pnpm firestore:deploy`: Deploy Firestore rules/indexes.
- `pnpm deploy:vercel`: Deploy app to Vercel.

## Critical Implementation Patterns

- Keep Firebase interactions in `src/lib/firebase/*` rather than inside route/page components.
- Keep business/domain helpers typed and testable in `src/lib/*`.
- Keep stateful client settings/auth logic in providers + stores (`src/components/providers`, `src/store`).
- Prefer existing UI primitives in `src/components/ui` to keep dashboard UX consistent.
