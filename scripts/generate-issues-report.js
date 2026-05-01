const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

// Configuration
const REPORT_BASE_DIR = path.join(__dirname, "../docs/reports");
const now = new Date();
const year = now.getFullYear();
const month = String(now.getMonth() + 1).padStart(2, "0");
const day = String(now.getDate()).padStart(2, "0");
const REPORT_DIR = path.join(REPORT_BASE_DIR, `${year}/${month}/${day}`);
const OUTPUT_FILE = path.join(REPORT_DIR, "report.md");

// Ensure docs/reports exists
if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

console.log("🔍 Checking requirements...");

try {
  execSync("gh --version", { stdio: "ignore" });
} catch {
  console.error("❌ Error: GitHub CLI (gh) is not installed or not in PATH.");
  process.exit(1);
}

console.log("📥 Fetching issues from GitHub...");

// Fetch Epics
const epicsJson = execSync(
  'gh issue list --search "label:\\"type: epic\\" state:open" --json number,title,body,labels,state,assignees,url',
  { encoding: "utf-8" },
);
const epics = JSON.parse(epicsJson);

// Fetch All Open Issues (limit 1000 to be safe)
const issuesJson = execSync(
  "gh issue list --state open --limit 1000 --json number,title,body,labels,state,assignees,url",
  { encoding: "utf-8" },
);
const allIssues = JSON.parse(issuesJson);

console.log(`✅ Fetched ${epics.length} Epics and ${allIssues.length} Issues.`);

// Map Epics
const epicsMap = new Map();
epics.forEach((epic) => {
  epicsMap.set(epic.number, {
    ...epic,
    children: [],
  });
});

const orphanIssues = [];

// Helper: Get Priority
const getPriorityInfo = (issue) => {
  const pLabel = issue.labels.find((l) =>
    l.name.toLowerCase().startsWith("priority: "),
  );
  if (!pLabel) {
    return { value: 4, label: "None" };
  }
  const label = pLabel.name.split(": ")[1] || "None";
  switch (label.toUpperCase()) {
    case "P0":
      return { value: 0, label };
    case "P1":
      return { value: 1, label };
    case "P2":
      return { value: 2, label };
    case "P3":
      return { value: 3, label };
    default:
      return { value: 4, label: "None" };
  }
};

const getPriority = (issue) => getPriorityInfo(issue).value;
const getPriorityLabel = (issue) => getPriorityInfo(issue).label;

const getAssignee = (issue) => {
  return issue.assignees && issue.assignees.length > 0
    ? issue.assignees.map((a) => a.login).join(", ")
    : "";
};

// Process Issues
allIssues.forEach((issue) => {
  // If it's an epic, skip (already in epicsMap)
  if (epicsMap.has(issue.number)) return;

  let parentId = null;

  // Strategy 1: Body parsing for "Parent Epic: #123"
  if (!parentId) {
    const patterns = [
      /Parent Epic:\s*#(\d+)/i,
      /Epic:\s*#(\d+)/i,
      /Part of\s*(?:Epic)?\s*#(\d+)/i,
      /Parent:\s*#(\d+)/i,
    ];
    for (const p of patterns) {
      const match = (issue.body || "").match(p);
      if (match) {
        parentId = Number.parseInt(match[1], 10);
        break;
      }
    }
  }

  // Strategy 3: Reverse lookup (Epic body contains #issue)
  if (!parentId) {
    for (const [id, epic] of epicsMap.entries()) {
      const regex = new RegExp(`#${issue.number}\\b`);
      if (epic.body && regex.test(epic.body)) {
        parentId = id;
        break;
      }
    }
  }

  if (parentId && epicsMap.has(parentId)) {
    epicsMap.get(parentId).children.push(issue);
  } else {
    orphanIssues.push(issue);
  }
});

// Sort
epicsMap.forEach((epic) => {
  epic.children.sort((a, b) => getPriority(a) - getPriority(b));
});
orphanIssues.sort((a, b) => getPriority(a) - getPriority(b));

// Generate Markdown
let md = `# Open Issues Report\n\nGenerated on ${new Date().toISOString()}\n\n`;

// Epics
for (const epic of epicsMap.values()) {
  md += `## [Epic] ${epic.title} ([#${epic.number}](${epic.url}))\n\n`;
  md += `**Priority**: ${getPriorityLabel(epic)} | **Assigned**: ${getAssignee(epic) || "Unassigned"}\n\n`;

  if (epic.children.length > 0) {
    md += "| Priority | ID | Title | Status | Assignee |\n";
    md += "|---|---|---|---|---|\n";
    epic.children.forEach((issue) => {
      md += `| ${getPriorityLabel(issue)} | #${issue.number} | [${issue.title}](${issue.url}) | 🟢 ${issue.state} | ${getAssignee(issue)} |\n`;
    });
  } else {
    md += "_No open child issues found._\n";
  }
  md += "\n";
}

// Orphans
if (orphanIssues.length > 0) {
  md += "## Issues Not Assigned to an Epic\n\n";
  md += "| Priority | ID | Title | Status | Assignee |\n";
  md += "|---|---|---|---|---|\n";
  orphanIssues.forEach((issue) => {
    md += `| ${getPriorityLabel(issue)} | #${issue.number} | [${issue.title}](${issue.url}) | 🟢 ${issue.state} | ${getAssignee(issue)} |\n`;
  });
  md += "\n";
}

fs.writeFileSync(OUTPUT_FILE, md);
console.log(`\n🎉 Report generated: \n👉 ${OUTPUT_FILE}`);
