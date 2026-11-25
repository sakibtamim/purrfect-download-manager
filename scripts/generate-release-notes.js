const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const CATEGORY_DEFINITIONS = [
  {
    key: 'features',
    title: '🚀 Features & Enhancements',
    types: new Set(['feat', 'feature', 'enhancement', 'perf']),
  },
  {
    key: 'fixes',
    title: '🛡️ Bug Fixes & Security Hardening',
    types: new Set(['fix', 'bug', 'security']),
  },
  {
    key: 'maintenance',
    title: '📦 Maintenance & Release',
    types: new Set(['chore', 'ci', 'docs', 'refactor', 'style', 'test', 'build', 'revert', 'other']),
  },
];

function parseConventionalCommit(subject) {
  const trimmed = typeof subject === 'string' ? subject.trim() : '';
  const match = trimmed.match(/^([a-zA-Z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/);
  if (!match) {
    return {
      type: 'other',
      scope: null,
      breaking: false,
      description: trimmed,
    };
  }

  const rawScope = match[2] ? match[2].trim() : '';
  return {
    type: match[1].toLowerCase(),
    scope: rawScope.length > 0 ? rawScope : null,
    breaking: Boolean(match[3]),
    description: match[4].trim(),
  };
}

function categorizeCommit(type) {
  const normalized = typeof type === 'string' ? type.toLowerCase() : 'other';
  for (const category of CATEGORY_DEFINITIONS) {
    if (category.types.has(normalized)) {
      return category.key;
    }
  }
  return 'maintenance';
}

function formatCommitBullet(commit) {
  const parsed = parseConventionalCommit(commit.subject);
  const parts = [];
  if (parsed.breaking) {
    parts.push('**BREAKING:**');
  }
  if (parsed.scope) {
    parts.push(`**${parsed.scope}:**`);
  }
  parts.push(parsed.description);
  const hash = typeof commit.hash === 'string' ? commit.hash.trim() : '';
  const hashSuffix = hash ? ` (\`${hash}\`)` : '';
  return `- ${parts.join(' ')}${hashSuffix}`;
}

function normalizeRepoUrl(rawUrl, serverUrl = 'https://github.com') {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  const cleanServer = (typeof serverUrl === 'string' && serverUrl.trim() ? serverUrl.trim() : 'https://github.com').replace(/\/+$/, '');

  // owner/repo shorthand
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    return `${cleanServer}/${trimmed.replace(/\.git$/, '')}`;
  }

  // SSH SCP-like syntax: git@github.com:owner/repo.git
  const sshScpMatch = trimmed.match(/^[^@]+@([^:]+):(.+)$/);
  if (sshScpMatch) {
    const host = sshScpMatch[1];
    const repoPath = sshScpMatch[2].replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
    return `https://${host}/${repoPath}`;
  }

  // ssh://git@github.com/owner/repo.git
  if (trimmed.startsWith('ssh://')) {
    const withoutScheme = trimmed.slice('ssh://'.length).replace(/^[^@]+@/, '');
    return `https://${withoutScheme.replace(/\.git$/, '').replace(/\/+$/, '')}`;
  }

  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed.replace(/\.git$/, '').replace(/\/+$/, '');
  }

  return null;
}

function runGit(cwd, args) {
  return childProcess.execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function findPreviousTag(cwd, currentTag, targetRef = 'HEAD') {
  const args = ['describe', '--tags', '--abbrev=0'];
  if (currentTag && currentTag !== 'HEAD') {
    args.push(`--exclude=${currentTag}`);
  }
  args.push(targetRef);

  try {
    const stdout = runGit(cwd, args).trim();
    return stdout || null;
  } catch {
    return null;
  }
}

function getCommitsInRange({ cwd, prevTag, targetRef = 'HEAD' }) {
  const range = prevTag ? `${prevTag}..${targetRef}` : targetRef;
  let stdout = '';
  try {
    stdout = runGit(cwd, ['log', range, '--no-merges', '--pretty=format:%h%x1f%s']);
  } catch (err) {
    const message = err && err.stderr ? String(err.stderr).trim() : String(err);
    throw new Error(`Failed to read git log for range "${range}": ${message}`);
  }

  const commits = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const sepIdx = line.indexOf('\x1f');
    if (sepIdx === -1) {
      commits.push({ hash: '', subject: line.trim() });
    } else {
      const hash = line.slice(0, sepIdx).trim();
      const subject = line.slice(sepIdx + 1).trim();
      if (subject) {
        commits.push({ hash, subject });
      }
    }
  }
  return commits;
}

function readPackageTag(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const version = typeof pkg.version === 'string' ? pkg.version.trim() : '';
    return version ? `v${version}` : null;
  } catch {
    return null;
  }
}

function resolveRepoUrl({ cwd, repoUrl, repo, env = process.env }) {
  const serverUrl = env.GITHUB_SERVER_URL || 'https://github.com';
  if (repoUrl) {
    return normalizeRepoUrl(repoUrl, serverUrl);
  }
  if (repo) {
    return normalizeRepoUrl(repo, serverUrl);
  }
  if (env.GITHUB_REPOSITORY) {
    return normalizeRepoUrl(env.GITHUB_REPOSITORY, serverUrl);
  }
  try {
    const remoteUrl = runGit(cwd, ['remote', 'get-url', 'origin']).trim();
    return normalizeRepoUrl(remoteUrl, serverUrl);
  } catch {
    return null;
  }
}

function formatReleaseNotes({ commits, prevTag, currentTag, repoUrl }) {
  const grouped = {
    features: [],
    fixes: [],
    maintenance: [],
  };

  for (const commit of commits) {
    const parsed = parseConventionalCommit(commit.subject);
    if (!parsed.description) continue;
    const categoryKey = categorizeCommit(parsed.type);
    grouped[categoryKey].push(formatCommitBullet(commit));
  }

  const sections = [];
  for (const category of CATEGORY_DEFINITIONS) {
    const items = grouped[category.key];
    if (items.length > 0) {
      sections.push(`## ${category.title}\n\n${items.join('\n')}`);
    }
  }

  if (sections.length === 0) {
    const emptyLine = prevTag
      ? `No changes recorded since \`${prevTag}\`.`
      : 'No changes recorded.';
    sections.push(emptyLine);
  }

  if (repoUrl && prevTag && currentTag && currentTag !== 'HEAD') {
    sections.push(`**Full Changelog**: ${repoUrl}/compare/${prevTag}...${currentTag}`);
  }

  return `${sections.join('\n\n')}\n`;
}

function generateReleaseNotes(options = {}) {
  const {
    cwd = process.cwd(),
    currentTag,
    prevTag,
    targetRef = 'HEAD',
    repo,
    repoUrl,
    outFile,
    env = process.env,
  } = options;

  const resolvedCurrentTag = currentTag || env.RELEASE_TAG || readPackageTag(cwd) || 'HEAD';
  const resolvedPrevTag =
    prevTag !== undefined
      ? prevTag || null
      : findPreviousTag(cwd, resolvedCurrentTag, targetRef);
  const commits = getCommitsInRange({
    cwd,
    prevTag: resolvedPrevTag,
    targetRef,
  });
  const resolvedRepoUrl = resolveRepoUrl({ cwd, repoUrl, repo, env });
  const markdown = formatReleaseNotes({
    commits,
    prevTag: resolvedPrevTag,
    currentTag: resolvedCurrentTag,
    repoUrl: resolvedRepoUrl,
  });

  if (outFile) {
    const resolvedOut = path.resolve(cwd, outFile);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, markdown, 'utf8');
  }

  return {
    markdown,
    prevTag: resolvedPrevTag,
    currentTag: resolvedCurrentTag,
    repoUrl: resolvedRepoUrl,
    commits,
  };
}

function parseCliArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const eqIdx = arg.indexOf('=');
    let key;
    let value;
    if (eqIdx !== -1) {
      key = arg.slice(2, eqIdx);
      value = arg.slice(eqIdx + 1);
    } else {
      key = arg.slice(2);
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for CLI option --${key}`);
      }
      i += 1;
    }

    switch (key) {
      case 'tag':
        opts.currentTag = value;
        break;
      case 'prev-tag':
        opts.prevTag = value;
        break;
      case 'target':
        opts.targetRef = value;
        break;
      case 'out':
      case 'output':
        opts.outFile = value;
        break;
      case 'repo':
        opts.repo = value;
        break;
      case 'repo-url':
        opts.repoUrl = value;
        break;
      case 'cwd':
        opts.cwd = path.resolve(value);
        break;
      default:
        throw new Error(`Unknown CLI option --${key}`);
    }
  }
  return opts;
}

if (require.main === module) { // agyis: no-mutant CLI entrypoint guard
  const cliOptions = parseCliArgs(process.argv.slice(2)); // agyis: no-mutant CLI entrypoint guard
  const result = generateReleaseNotes(cliOptions); // agyis: no-mutant CLI entrypoint guard
  if (!cliOptions.outFile) { // agyis: no-mutant CLI entrypoint guard
    process.stdout.write(result.markdown); // agyis: no-mutant CLI entrypoint guard
  } // agyis: no-mutant CLI entrypoint guard
}

module.exports = {
  CATEGORY_DEFINITIONS,
  categorizeCommit,
  findPreviousTag,
  formatCommitBullet,
  formatReleaseNotes,
  generateReleaseNotes,
  getCommitsInRange,
  normalizeRepoUrl,
  parseCliArgs,
  parseConventionalCommit,
  resolveRepoUrl,
};
