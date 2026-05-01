#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

function showHelp() {
  console.log(`
Usage:
  node scripts/gh-pr-review-comments.js <pr-number> [review-id] [--file <output-file>] [--delta]

Examples:
  # Print all review comments to stdout
  node scripts/gh-pr-review-comments.js 34 3517858180

  # Print NEW comments since you last said "Code Review Addressed"
  node scripts/gh-pr-review-comments.js 34 --delta

  # Save comments into a file (creates or appends)
  node scripts/gh-pr-review-comments.js 34 3517858180 --file /tmp/review.txt

Description:
  Fetches all comments under the specified Pull Request review and outputs
  them in a readable format.

Options:
  --delta    Only fetch comments posted AFTER your last "Code Review Addressed" comment.
             Use this to find unaddressed feedback in ongoing reviews.

  Requires: GitHub CLI (gh), with repo authenticated.
`);
}

const args = process.argv.slice(2);
let prNumber = null;
let reviewId = null;
let outputFile = null;
let deltaMode = false;

// Parse arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    showHelp();
    process.exit(0);
  } else if (arg === "--file" || arg === "-f") {
    const next = args[i + 1];
    if (!next || String(next).startsWith("-")) {
      console.error("❌ Error: --file requires a path argument.");
      showHelp();
      process.exit(1);
    }
    outputFile = next;
    i++; // skip next arg
  } else if (arg === "--delta") {
    deltaMode = true;
  } else if (!prNumber) {
    prNumber = arg;
  } else if (!reviewId) {
    reviewId = arg;
  }
}

if (!prNumber) {
  console.error(
    "❌ Error: Missing required arguments. PR Number is mandatory.",
  );
  showHelp();
  process.exit(1);
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(`❌ Error: ${label} must be a positive integer.`);
    process.exit(1);
  }
  return parsed;
}

const parsedPrNumber = parsePositiveInt(prNumber, "PR number");
if (reviewId) {
  reviewId = String(parsePositiveInt(reviewId, "Review ID"));
}

function ghApiJson(path, { paginate = false, slurp = false } = {}) {
  const args = ["api", path];
  if (paginate) {
    args.push("--paginate");
  }
  if (slurp) {
    args.push("--slurp");
  }

  const output = execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  return JSON.parse(output);
}

function getCurrentUser() {
  try {
    return execFileSync("gh", ["api", "user", "--jq", ".login"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    console.warn(
      "⚠️ Could not determine current user. Delta mode might be inaccurate.",
    );
    return null;
  }
}

function getLastAddressedTime(prNum, user) {
  if (!user) return null;
  try {
    const pages = ghApiJson(`repos/:owner/:repo/issues/${prNum}/comments`, {
      paginate: true,
      slurp: true,
    });
    const comments = pages.flat();

    // API may return comments oldest-first. Find the most recent marker by
    // searching from the end. Allow several phrasing variants (case-insensitive).
    const markerRegex =
      /Code Review( Feedback)? Addressed|CR( Feedback)? Addressed/i;
    const reversed = Array.isArray(comments) ? comments.slice().reverse() : [];
    const marker = reversed.find(
      (c) => c.user && c.user.login === user && markerRegex.test(c.body || ""),
    );

    return marker ? new Date(marker.created_at) : null;
  } catch {
    return null;
  }
}

try {
  let cutoffDate = null;

  if (deltaMode) {
    console.log("🕵️ Delta Mode: Looking for your last 'Address' comment...");
    const user = getCurrentUser();
    cutoffDate = getLastAddressedTime(parsedPrNumber, user);

    if (cutoffDate) {
      console.log(
        `📅 Found marker. Fetching comments after: ${cutoffDate.toLocaleString()}`,
      );
    } else {
      console.log(
        "⚠️ No 'Code Review Addressed' comment found. Fetching ALL history.",
      );
    }
  }

  // If no reviewId provided, try to discover reviews with unaddressed comments
  if (!reviewId) {
    if (!deltaMode)
      console.log(
        `🔍 No Review ID provided. Searching for reviews in PR #${prNumber}...`,
      );

    // Fetch all comments to aggregate Review IDs
    const pages = ghApiJson(
      `repos/:owner/:repo/pulls/${parsedPrNumber}/comments`,
      {
        paginate: true,
        slurp: true,
      },
    );
    let comments = pages.flat();

    // Filter by date if in delta mode
    if (cutoffDate) {
      comments = comments.filter((c) => new Date(c.created_at) > cutoffDate);
    }

    if (!Array.isArray(comments) || comments.length === 0) {
      console.log(
        cutoffDate
          ? "✅ No new comments found since your last update!"
          : "No inline comments found for this PR.",
      );
      process.exit(0);
    }

    // Group by review_id
    const reviews = {};
    comments.forEach((c) => {
      if (c.pull_request_review_id) {
        if (!reviews[c.pull_request_review_id]) {
          reviews[c.pull_request_review_id] = {
            id: c.pull_request_review_id,
            author: c.user.login,
            count: 0,
            lastDate: c.created_at,
          };
        }
        reviews[c.pull_request_review_id].count++;
        if (
          new Date(c.created_at) >
          new Date(reviews[c.pull_request_review_id].lastDate)
        ) {
          reviews[c.pull_request_review_id].lastDate = c.created_at;
        }
      }
    });

    const reviewsList = Object.values(reviews);

    if (reviewsList.length === 0) {
      console.log("Found comments, but none are associated with a review ID.");
      process.exit(0);
    }

    console.log(`\nFound ${reviewsList.length} Active Review Threads:`);
    console.log("------------------------------------------------------------");
    console.log(
      String("ID").padEnd(15) +
        String("Author").padEnd(20) +
        String("Comments").padEnd(10) +
        "Latest",
    );
    console.log("------------------------------------------------------------");

    reviewsList.forEach((r) => {
      console.log(
        `${String(r.id).padEnd(15)} ${String(r.author).padEnd(20)} ${String(r.count).padEnd(10)} ${new Date(r.lastDate).toLocaleString()}`,
      );
    });
    console.log("------------------------------------------------------------");
    console.log("\nTo fetch comments for a specific review, run:");
    console.log(
      `node scripts/gh-pr-review-comments.js ${prNumber} <REVIEW_ID>`,
    );

    process.exit(0);
  }

  // Fetch specific review comments
  const pages = ghApiJson(
    `repos/:owner/:repo/pulls/${parsedPrNumber}/reviews/${reviewId}/comments`,
    { paginate: true, slurp: true },
  );
  let comments = pages.flat();

  // Filter by date if in delta mode
  if (cutoffDate) {
    comments = comments.filter((c) => new Date(c.created_at) > cutoffDate);
  }

  if (!Array.isArray(comments) || comments.length === 0) {
    console.log(
      "No comments found for this review" +
        (cutoffDate ? " in the new window." : "."),
    );
    process.exit(0);
  }

  let formattedOutput = "";

  comments.forEach((c) => {
    const originalLine = c.original_line || c.line || "N/A";
    const header = `------------------------------------------------------------
Comment #${c.id} by ${c.user.login} on ${c.path}:${originalLine}
State: ${c.state || "N/A"} | Created: ${c.created_at}

${c.body}

Code context:
${c.diff_hunk}

`;
    formattedOutput += header;
  });

  if (outputFile) {
    fs.appendFileSync(outputFile, formattedOutput, "utf8");
    console.log(`✔ Review comments appended to: ${outputFile}`);
  } else {
    process.stdout.write(formattedOutput);
  }
} catch (error) {
  console.error("❌ Error execution failed:");
  console.error(error.message);
  if (error.stderr) {
    console.error(error.stderr.toString());
  }
  process.exit(1);
}
