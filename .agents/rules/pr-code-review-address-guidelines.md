---
trigger: always_on
---

# Code Review Workflow

## Fetching PR Review Comments

First ensure you are on the correct branch, the branch is up to date, and you have the explicit IDs of the Pull Request and Review.
There are two ways for an Agent to fetch code review comments: Using the **GitHub MCP Server** (Primary/Recommended) and using **CLI Scripts** (Fallback).

### Primary Method: GitHub MCP Server (Recommended)
If the project environment provides access to an authenticated GitHub MCP server, you **MUST** use it to fetch the pull request and its review comments. It is more reliable, does not require running local node scripts, and yields clean JSON.

1.  Use the `mcp_github_get_pull_request` tool to fetch the PR context (`owner`, `repo`, `pull_number`).
2.  Use the `mcp_github_get_pull_request_reviews` and `mcp_github_get_pull_request_comments` tools with the same parameters to fetch all inline comments and review threads.
3.  Cross-reference the comments to build an action plan.

### Fallback Method: CLI Scripts
If the GitHub MCP Server is unavailable or fails, fall back to the CLI script workflow.

#### Get Review ID from URL (When provided)

The review URL format is: `https://github.com/OWNER/REPO/pull/NUMBER#pullrequestreview-REVIEW_ID`

#### If you are in a branch of a known pull request (i.e. continuous conversations)

Use the known PR ID and retrieve the latest sets of review comments (based on UTC time).

#### If either PR Number or Review ID is not provided or correctly inferrable

Refuse to address any CR feedback, instruct on the correct approach based on this document.

Then, use the `scripts/gh-pr-review-comments.js` script to fetch ALL inline comments.

```bash
# 1. Discover available reviews (Auto-mode)
node scripts/gh-pr-review-comments.js <PR_NUMBER>

# 2. Fetch specific review comments
node scripts/gh-pr-review-comments.js <PR_NUMBER> <REVIEW_ID>

# 3. Delta Mode (Fetch ONLY unaddressed feedback)
# Use this when you have already addressed some comments and posted a "Code Review Addressed" reply.
node scripts/gh-pr-review-comments.js <PR_NUMBER> --delta

# Save to a file (REQUIRED)
node scripts/gh-pr-review-comments.js <PR_NUMBER> --delta --file /tmp/new_feedback.md
```

### IMPORTANT: ALWAYS use a temporary out of working tree location for the review comment files (if fetching via script). NEVER COMMIT ANY review comment files to git, EVER!

### Important Notes

- **Always use the MCP tools first.** Only fallback to scripts if MCP fails.
- Treat all comments as valid, at least worthy of a rebuttal, use the priority hints as suggestions, but NEVER ignore a comment without notifying the operator.
- **Auto-Proceed:** Continue executing the fixes, committing the changes (grouped logically), pushing, and replying to the PR **UNLESS** you require explicit clarification or intervention from the Operator. Do not stop just to report "I'm done fixing", finish the entire cycle.
- Once review comments are addressed (in focused commits for groups of related review comments/commits), use the `mcp_github_create_pull_request_review` tool or `gh pr review` to post a Top Level Reply directly to the PR, addressing all the feedback (grouped when possible for conciseness) both the addressed one and especially the rejected/deferred points clearly, with follow up issues filed (using GH cli) and linked for deferred points.

NEVER. UNDER. ANY. CIRCUMSTANCES. IGNORE. ANY. ON. THE. POINTS. OF. THIS. FILE.
(if instructions provided here are not followable for any reason, exit with a CLEAR reason and report it to the operator.)

## 🧠 CLI Power User Tips (Linux/Unix)

### Quick Find & Replace

Use `sed` to replace text across files in a flash without opening editors.

```bash
# Syntax: sed -i 's|old_text|new_text|g' filename
sed -i 's|scripts/gh-pr-review-comments.sh|node scripts/gh-pr-review-comments.js|g' README.md
```

### GitHub API Magic

Use `gh api` to probe PR data when the standard CLI commands aren't enough.

```bash
# Get all comment Review IDs for a PR
gh api repos/:owner/:repo/pulls/<PR_ID>/comments --jq '[.[].pull_request_review_id] | unique'
```

## 📊 Review Statistics & Reporting

When reporting the completion of a Code Review cycle to the Operator, you MUST follow this strict reporting format.

### 1. High Level Brief

Start with a grouped summary of what was fixed.

- **Topic A**: Description of fix.
- **Topic B**: Description of fix.

### 2. Detailed Stats Table

Include a clear, precise table. **CRITICAL**: 
- Wrap all GitHub handles in backticks (e.g., `@user`) to avoid unnecessary notifications.
- **ALWAYS** use absolute UTC timestamps (e.g., `YYYY-MM-DD HH:MM UTC`) for the "Latest Activity" column, never relative times like "Today" or "2h ago".

| Reviewer | Comments | Status | Latest Activity (UTC) |
| :--- | :--- | :--- | :--- |
| **`@gemini-code-assist`** | 5 | ✅ 5 Fixed | 2026-03-12 10:15 UTC |
| **`@chatgpt-codex-connector`** | 2 | ✅ 1 Fixed, ⏳ 1 Deferred | 2026-03-12 11:30 UTC |

**Total**: 7 Comments (6 Fixed, 1 Deferred)

### 3. Condensed Stats Panel

Always include a `<details>` block with the following specific summary text format at the very bottom of your comment:

`[⚡ Assessed <Total> comments across <Count> reviews from <ReviewerCount> reviewers between <StartTime_UTC> and <EndTime_UTC>. Processing time: ~<Duration> minutes. Click for details]`

#### Example Output:

### 📝 CR Feedback Addressed

- **Schema**: Fixed relational integrity for Assets.
- **Auth**: Clarified bootstrap process.

| Reviewer | Comments | Status | Latest Activity (UTC) |
| :--- | :--- | :--- | :--- |
| **`@gemini-code-assist`** | 5 | ✅ 5 Fixed | 2026-03-12 10:15 UTC |

<details>
<summary>[⚡ Assessed 5 comments across 1 reviews from 1 reviewers between 2026-03-12 10:00 UTC and 2026-03-12 10:30 UTC. Processing time: ~30 minutes. Click for details]</summary>

- **Reviewers**: 1 (`@gemini-code-assist`)
- **Coverage**: 100% Addressed
- **AI-Human Collaboration**: 🤖 Agent 47 x 👤 Reviewers
</details>

## 🏅 Golden Example (Ad-hoc)

Here is a real-world example of a "Purrfect" PR comment that addresses multiple rounds of feedback with high fidelity, concrete timestamps, and clarity. Strive for this level of detail.

### 📝 Code Review Feedback Addressed (Round 2)

I have rigorously addressed **ALL** feedback from the latest review cycle, ensuring no points were missed.

#### 🔴 Critical Fixes

- **Delete Confirmation (Gemini)**: Use `AlertDialog` in `NewsList` to require explicit confirmation before deleting news events, preventing accidental data loss.
- **Error Handling (Copilot)**: Added `toast.error` handling in `deleteMutation` within `NewsIndexPage` to properly inform users if a deletion fails.
- **Security (Codex)**: Restricted the public `newsEvents.get` procedure to only return events with `status: PUBLISHED` and `publishAt <= NOW`.

#### 🟡 Stability & UX Fixes

- **Client Crash (Codex)**: Refactored `EditNewsPage` to use `useParams()` instead of `use(params)` to prevent runtime errors in Next.js 15 client components.
- **Slug Generation (Copilot)**: Implemented a fallback strategy for slug generation to handle empty or special-character-only titles.
- **Asset Logic (Copilot)**: Updated `AssetGrid` to pass `undefined` for `onDelete` when in selection mode, and updated `AssetCard` to treat `onDelete` as optional, eliminating misleading UI behavior.

#### 🟢 Accessibility

- **Calendar Props (Gemini)**: Fixed `Chevron` components in `Calendar` to correctly pass through all props, ensuring accessibility compliance.

| Reviewer | Comments | Status | Latest Activity (UTC) |
| :--- | :--- | :--- | :--- |
| **`@gemini-code-assist`** | 5 | ✅ 5 Fixed | 2026-03-12 10:15 UTC |
| **`@chatgpt-codex-connector`** | 3 | ✅ 3 Fixed | 2026-03-12 10:20 UTC |
| **`@copilot-pull-request-reviewer`** | 12 | ✅ 12 Fixed | 2026-03-12 10:45 UTC |

<details>
<summary>[⚡ Assessed 20 comments across 3 reviews from 3 reviewers between 2026-03-12 10:15 UTC and 2026-03-12 10:45 UTC. Processing time: ~30 minutes. Click for details]</summary>

- **Reviewers**: 3 (`@gemini-code-assist`, `@chatgpt-codex-connector`, `@copilot-pull-request-reviewer`)
- **Coverage**: 100% Addressed
</details>
