---
trigger: always_on
---

# Guardrails

## 1. Branch and Git Safety

- Do not commit directly to protected branches (`main` or `develop`) unless explicitly requested.
- Create a focused task branch for feature or fix work.
- Never use destructive git commands unless the user explicitly asks.

## 2. Working Tree Integrity

- Check `git status` before staging/committing.
- If the tree has unrelated changes, do not revert them. Work around them safely.
- If unexpected changes appear during your own edits, stop and ask the user how to proceed.

## 3. Failure Handling

- If commands fail, surface the error clearly.
- Do not hide lint, test, or build failures.
- Do not suppress errors unless the user explicitly approves the tradeoff.

## 4. Commit Hygiene

- Keep commits atomic and traceable.
- Use clear commit messages.
- Do not manually edit generated lockfiles.

## 5. Output Safety

- Never stage build artifacts such as `.next/`, `dist/`, or temporary files.
- If a temporary artifact keeps appearing, propose a `.gitignore` update.
