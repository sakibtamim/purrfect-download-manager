import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import childProcess from 'child_process';
import { syncVersions } from './sync-versions.js';

describe('syncVersions', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function createFixtureWorkspace() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdm-sync-test-'));
    tempDirs.push(rootDir);

    fs.mkdirSync(path.join(rootDir, 'src-tauri'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'packaging/archlinux'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'extension'), { recursive: true });

    fs.writeFileSync(
      path.join(rootDir, 'package.json'),
      JSON.stringify({ name: 'purrfect-download-manager', version: '0.1.2' }, null, 2)
    );
    fs.writeFileSync(
      path.join(rootDir, 'src-tauri/tauri.conf.json'),
      JSON.stringify({ productName: 'PDM', version: '0.1.1' }, null, 2)
    );
    fs.writeFileSync(
      path.join(rootDir, 'src-tauri/Cargo.toml'),
      '[package]\nname = "purrfect-download-manager"\nversion = "0.1.1"\n'
    );
    fs.writeFileSync(
      path.join(rootDir, 'packaging/archlinux/PKGBUILD'),
      'pkgname=purrfect-download-manager\npkgver=0.1.1\npkgrel=1\n'
    );
    fs.writeFileSync(
      path.join(rootDir, 'extension/manifest.json'),
      JSON.stringify({ manifest_version: 3, name: 'PDM', version: '1.0' }, null, 2)
    );

    return rootDir;
  }

  it('syncs package.json version across tauri.conf.json, Cargo.toml, PKGBUILD, and extension/manifest.json and updates Cargo.lock by default', () => {
    const rootDir = createFixtureWorkspace();
    const execSpy = vi.spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

    const synced = syncVersions(rootDir);
    expect(synced).toBe('0.1.2');
    expect(execSpy).toHaveBeenCalledWith(
      'cargo update -p purrfect-download-manager --offline',
      expect.objectContaining({ cwd: path.join(rootDir, 'src-tauri') })
    );

    const tauriConf = JSON.parse(fs.readFileSync(path.join(rootDir, 'src-tauri/tauri.conf.json'), 'utf8'));
    expect(tauriConf.version).toBe('0.1.2');

    const cargoToml = fs.readFileSync(path.join(rootDir, 'src-tauri/Cargo.toml'), 'utf8');
    expect(cargoToml).toContain('version = "0.1.2"');

    const pkgbuild = fs.readFileSync(path.join(rootDir, 'packaging/archlinux/PKGBUILD'), 'utf8');
    expect(pkgbuild).toContain('pkgver=0.1.2');

    const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'extension/manifest.json'), 'utf8'));
    expect(manifest.version).toBe('0.1.2');
  });

  it('skips Cargo.lock update when updateCargoLock is false', () => {
    const rootDir = createFixtureWorkspace();
    const execSpy = vi.spyOn(childProcess, 'execSync').mockImplementation(() => Buffer.from(''));

    const synced = syncVersions(rootDir, { updateCargoLock: false });
    expect(synced).toBe('0.1.2');
    expect(execSpy).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(rootDir, 'src-tauri/Cargo.toml'), 'utf8')).toContain('version = "0.1.2"');
    expect(fs.readFileSync(path.join(rootDir, 'packaging/archlinux/PKGBUILD'), 'utf8')).toContain('pkgver=0.1.2');
  });

  it('throws when package.json is missing a valid version and still updates empty tauri.conf.json version', () => {
    const rootDir = createFixtureWorkspace();
    fs.writeFileSync(
      path.join(rootDir, 'package.json'),
      JSON.stringify({ name: 'purrfect-download-manager', version: '   ' }, null, 2)
    );
    expect(() => syncVersions(rootDir, { updateCargoLock: false })).toThrow(/missing a valid "version"/);

    fs.writeFileSync(
      path.join(rootDir, 'package.json'),
      JSON.stringify({ name: 'purrfect-download-manager', version: '0.1.2' }, null, 2)
    );
    fs.writeFileSync(
      path.join(rootDir, 'src-tauri/tauri.conf.json'),
      JSON.stringify({ productName: 'PDM', version: '' }, null, 2)
    );
    syncVersions(rootDir, { updateCargoLock: false });
    const tauriConf = JSON.parse(fs.readFileSync(path.join(rootDir, 'src-tauri/tauri.conf.json'), 'utf8'));
    expect(tauriConf.version).toBe('0.1.2');
  });
});
