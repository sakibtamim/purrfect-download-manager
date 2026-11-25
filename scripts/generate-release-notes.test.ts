import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import childProcess from 'child_process';
import {
  categorizeCommit,
  findPreviousTag,
  formatCommitBullet,
  formatReleaseNotes,
  generateReleaseNotes,
  normalizeRepoUrl,
  parseCliArgs,
  parseConventionalCommit,
} from './generate-release-notes.js';

function git(cwd: string, args: string[]): string {
  return childProcess.execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test User',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test User',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
}

describe('generate-release-notes', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function createTempGitRepo(remoteUrl = 'https://github.com/sakibtamim/purrfect-download-manager.git') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdm-relnotes-'));
    tempDirs.push(dir);
    git(dir, ['init', '-b', 'main']);
    git(dir, ['config', 'user.name', 'Test User']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    if (remoteUrl) {
      git(dir, ['remote', 'add', 'origin', remoteUrl]);
    }
    return dir;
  }

  function commitFile(cwd: string, filename: string, content: string, message: string) {
    fs.writeFileSync(path.join(cwd, filename), content, 'utf8');
    git(cwd, ['add', filename]);
    git(cwd, ['commit', '-m', message]);
  }

  describe('parseConventionalCommit & categorizeCommit', () => {
    it('parses scoped, unscoped, breaking, and non-conventional commits', () => {
      expect(parseConventionalCommit('feat(storage): add multi-drive picker')).toEqual({
        type: 'feat',
        scope: 'storage',
        breaking: false,
        description: 'add multi-drive picker',
      });

      expect(parseConventionalCommit('fix!: handle empty payload')).toEqual({
        type: 'fix',
        scope: null,
        breaking: true,
        description: 'handle empty payload',
      });

      expect(parseConventionalCommit('security(engine)!: lock down local rpc')).toEqual({
        type: 'security',
        scope: 'engine',
        breaking: true,
        description: 'lock down local rpc',
      });

      expect(parseConventionalCommit('feat(): ignore empty scope parens')).toEqual({
        type: 'feat',
        scope: null,
        breaking: false,
        description: 'ignore empty scope parens',
      });

      expect(parseConventionalCommit('Update README manually')).toEqual({
        type: 'other',
        scope: null,
        breaking: false,
        description: 'Update README manually',
      });
    });

    it('maps commit types into the three release note categories', () => {
      expect(categorizeCommit('feat')).toBe('features');
      expect(categorizeCommit('perf')).toBe('features');
      expect(categorizeCommit('fix')).toBe('fixes');
      expect(categorizeCommit('security')).toBe('fixes');
      expect(categorizeCommit('chore')).toBe('maintenance');
      expect(categorizeCommit('ci')).toBe('maintenance');
      expect(categorizeCommit('docs')).toBe('maintenance');
      expect(categorizeCommit('refactor')).toBe('maintenance');
      expect(categorizeCommit('other')).toBe('maintenance');
    });

    it('formats commit bullets cleanly with optional scope, breaking marker, and short sha', () => {
      expect(
        formatCommitBullet({ hash: 'abc1234', subject: 'feat(ui): polish download table' })
      ).toBe('- **ui:** polish download table (`abc1234`)');

      expect(
        formatCommitBullet({ hash: 'def5678', subject: 'chore: prune stale files' })
      ).toBe('- prune stale files (`def5678`)');

      expect(
        formatCommitBullet({ hash: '999aaaa', subject: 'fix(ipc)!: validate origin header' })
      ).toBe('- **BREAKING:** **ipc:** validate origin header (`999aaaa`)');
    });
  });

  describe('normalizeRepoUrl', () => {
    it('normalizes HTTPS, SSH SCP, ssh://, and owner/repo formats', () => {
      expect(normalizeRepoUrl('https://github.com/sakibtamim/purrfect-download-manager.git')).toBe(
        'https://github.com/sakibtamim/purrfect-download-manager'
      );
      expect(normalizeRepoUrl('git@github.com:sakibtamim/purrfect-download-manager.git')).toBe(
        'https://github.com/sakibtamim/purrfect-download-manager'
      );
      expect(normalizeRepoUrl('ssh://git@github.com/sakibtamim/purrfect-download-manager.git')).toBe(
        'https://github.com/sakibtamim/purrfect-download-manager'
      );
      expect(normalizeRepoUrl('sakibtamim/purrfect-download-manager')).toBe(
        'https://github.com/sakibtamim/purrfect-download-manager'
      );
      expect(normalizeRepoUrl('')).toBeNull();
    });
  });

  describe('formatReleaseNotes', () => {
    it('omits empty sections and appends a single Full Changelog link', () => {
      const md = formatReleaseNotes({
        commits: [
          { hash: '111aaaa', subject: 'fix(desktop): prevent inode collision' },
          { hash: '222bbbb', subject: 'ci: run checks on develop' },
        ],
        prevTag: 'v0.1.1',
        currentTag: 'v0.1.2',
        repoUrl: 'https://github.com/sakibtamim/purrfect-download-manager',
      });

      expect(md).not.toContain('Features & Enhancements');
      expect(md).toContain('## 🛡️ Bug Fixes & Security Hardening');
      expect(md).toContain('- **desktop:** prevent inode collision (`111aaaa`)');
      expect(md).toContain('## 📦 Maintenance & Release');
      expect(md).toContain('- run checks on develop (`222bbbb`)');
      expect(md).toContain(
        '**Full Changelog**: https://github.com/sakibtamim/purrfect-download-manager/compare/v0.1.1...v0.1.2'
      );
    });

    it('outputs a non-empty fallback message when no commits exist in range', () => {
      const md = formatReleaseNotes({
        commits: [],
        prevTag: 'v0.1.1',
        currentTag: 'v0.1.2',
        repoUrl: 'https://github.com/sakibtamim/purrfect-download-manager',
      });

      expect(md).toContain('No changes recorded since `v0.1.1`.');
      expect(md).toContain('compare/v0.1.1...v0.1.2');
    });
  });

  describe('git integration', () => {
    it('formats commits since previous tag excluding merge commits and writes --out file', () => {
      const repo = createTempGitRepo('git@github.com:sakibtamim/purrfect-download-manager.git');
      commitFile(repo, 'a.txt', 'v1', 'feat(core): initial setup');
      git(repo, ['tag', 'v0.1.1']);

      commitFile(repo, 'b.txt', 'v2', 'feat(ui): add dark mode toggle');
      commitFile(repo, 'c.txt', 'v3', 'security(rpc): restrict localhost origin');

      // Create a feature branch and merge with --no-ff to verify --no-merges excludes the merge commit
      git(repo, ['checkout', '-b', 'feat/branch']);
      commitFile(repo, 'd.txt', 'v4', 'chore(ci): enable develop checks');
      git(repo, ['checkout', 'main']);
      git(repo, ['merge', '--no-ff', 'feat/branch', '-m', 'Merge pull request #99 from feat/branch']);

      const outPath = path.join(repo, 'tmp', 'notes.md');
      const result = generateReleaseNotes({
        cwd: repo,
        currentTag: 'v0.1.2',
        outFile: 'tmp/notes.md',
        env: {},
      });

      expect(result.prevTag).toBe('v0.1.1');
      expect(result.commits).toHaveLength(3);
      expect(result.markdown).toContain('## 🚀 Features & Enhancements');
      expect(result.markdown).toContain('## 🛡️ Bug Fixes & Security Hardening');
      expect(result.markdown).toContain('## 📦 Maintenance & Release');
      expect(result.markdown).not.toContain('Merge pull request #99');
      expect(result.markdown).toContain(
        '**Full Changelog**: https://github.com/sakibtamim/purrfect-download-manager/compare/v0.1.1...v0.1.2'
      );
      expect(fs.readFileSync(outPath, 'utf8')).toBe(result.markdown);
    });

    it('excludes currentTag when it already exists on HEAD so tag-triggered builds still find the prior tag', () => {
      const repo = createTempGitRepo();
      commitFile(repo, 'a.txt', '1', 'feat: base');
      git(repo, ['tag', 'v0.1.1']);
      commitFile(repo, 'b.txt', '2', 'fix(linux): handle ext4 inode reuse');
      git(repo, ['tag', 'v0.1.2']);

      expect(findPreviousTag(repo, 'v0.1.2', 'HEAD')).toBe('v0.1.1');

      const result = generateReleaseNotes({
        cwd: repo,
        currentTag: 'v0.1.2',
        env: {},
      });
      expect(result.prevTag).toBe('v0.1.1');
      expect(result.commits).toHaveLength(1);
      expect(result.markdown).toContain('- **linux:** handle ext4 inode reuse');
      expect(result.markdown).toContain('compare/v0.1.1...v0.1.2');
    });

    it('handles repositories with no previous tag gracefully', () => {
      const repo = createTempGitRepo();
      commitFile(repo, 'a.txt', '1', 'feat: first commit');

      const result = generateReleaseNotes({
        cwd: repo,
        currentTag: 'v0.1.0',
        env: {},
      });
      expect(result.prevTag).toBeNull();
      expect(result.commits).toHaveLength(1);
      expect(result.markdown).toContain('- first commit');
      expect(result.markdown).not.toContain('Full Changelog');
    });

    it('uses GITHUB_REPOSITORY and GITHUB_SERVER_URL when remote is absent', () => {
      const repo = createTempGitRepo('');
      commitFile(repo, 'a.txt', '1', 'feat: initial');
      git(repo, ['tag', 'v0.1.0']);
      commitFile(repo, 'b.txt', '2', 'fix: bug');

      const result = generateReleaseNotes({
        cwd: repo,
        currentTag: 'v0.1.1',
        env: {
          GITHUB_REPOSITORY: 'sakibtamim/purrfect-download-manager',
          GITHUB_SERVER_URL: 'https://github.com',
        },
      });
      expect(result.markdown).toContain(
        '**Full Changelog**: https://github.com/sakibtamim/purrfect-download-manager/compare/v0.1.0...v0.1.1'
      );
    });
  });

  describe('parseCliArgs', () => {
    it('parses --key value and --key=value arguments and rejects missing values', () => {
      expect(
        parseCliArgs([
          '--tag',
          'v0.1.3',
          '--prev-tag=v0.1.2',
          '--target',
          'HEAD',
          '--out',
          '/tmp/notes.md',
          '--repo=owner/repo',
        ])
      ).toEqual({
        currentTag: 'v0.1.3',
        prevTag: 'v0.1.2',
        targetRef: 'HEAD',
        outFile: '/tmp/notes.md',
        repo: 'owner/repo',
      });

      expect(() => parseCliArgs(['--tag'])).toThrow(/Missing value for CLI option --tag/);
      expect(() => parseCliArgs(['--bogus', '1'])).toThrow(/Unknown CLI option --bogus/);
    });
  });
});
