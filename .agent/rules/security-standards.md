---
trigger: always_on
---

# Security Standards

## 1. Dependencies

- Check vulnerabilities when adding or upgrading packages (`pnpm audit`).
- Do not introduce new high/critical vulnerabilities.
- Prioritize security updates for core runtime dependencies.

## 2. Firebase and Data Access

- Maintain strict per-user isolation in Firestore rules.
- Keep Firestore schema constraints and allowed enums validated in rules.
- Avoid broad client-side writes that bypass domain guards.

## 3. Secrets and Environment

- Never hardcode credentials, tokens, or secrets in source files.
- Keep environment configuration in `.env.local` for local development.
- Ensure required public Firebase variables are documented in `.env.example`.

## 4. Release Checks

- Before deployment, run `pnpm predeploy:check`.
- For security-relevant changes, include tests or validation steps that prove behavior is enforced.
