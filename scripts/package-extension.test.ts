import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildTargetManifest, packageExtension } from './package-extension.js';

describe('packageExtension', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const sampleManifest = {
    manifest_version: 3,
    name: 'Purrfect Download Manager',
    version: '0.1.2',
    permissions: ['downloads', 'cookies', 'storage', 'contextMenus', 'notifications'],
    browser_specific_settings: {
      gecko: {
        id: 'pdm-extension@purrfecthq.com',
        strict_min_version: '109.0',
      },
    },
    background: {
      scripts: ['background.js'],
      service_worker: 'background.js',
    },
  };

  it('strips Firefox keys for Chrome store bundle and keeps service_worker', () => {
    const chromeManifest = JSON.parse(buildTargetManifest(sampleManifest, 'chrome').toString('utf8'));
    expect(chromeManifest.background).toEqual({ service_worker: 'background.js' });
    expect(chromeManifest.browser_specific_settings).toBeUndefined();
    expect(chromeManifest.version).toBe('0.1.2');
  });

  it('strips service_worker for Firefox AMO bundle and keeps gecko settings', () => {
    const firefoxManifest = JSON.parse(buildTargetManifest(sampleManifest, 'firefox').toString('utf8'));
    expect(firefoxManifest.background).toEqual({ scripts: ['background.js'] });
    expect(firefoxManifest.browser_specific_settings).toEqual(sampleManifest.browser_specific_settings);
    expect(firefoxManifest.version).toBe('0.1.2');
  });

  it('rejects unsupported browser targets', () => {
    expect(() => buildTargetManifest(sampleManifest, 'safari')).toThrow(/Unsupported extension target/);
  });

  it('builds valid non-empty zip bundles in distDir without leaking .DS_Store', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pdm-ext-pkg-'));
    tempDirs.push(tmpRoot);
    const extDir = path.join(tmpRoot, 'extension');
    const distDir = path.join(tmpRoot, 'dist');
    fs.mkdirSync(path.join(extDir, 'icons'), { recursive: true });
    fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(sampleManifest, null, 2));
    fs.writeFileSync(path.join(extDir, 'background.js'), 'console.log("ok");\n');
    fs.writeFileSync(path.join(extDir, 'icons/icon16.png'), Buffer.from([137, 80, 78, 71]));
    fs.writeFileSync(path.join(extDir, '.DS_Store'), 'junk');

    const outputs = packageExtension(extDir, distDir);
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toMatch(/pdm-extension-chrome-v0\.1\.2\.zip$/);
    expect(outputs[1]).toMatch(/pdm-extension-firefox-v0\.1\.2\.zip$/);

    for (const file of outputs) {
      const buf = fs.readFileSync(file);
      // ZIP magic PK\x03\x04
      expect(buf.subarray(0, 4).toString('binary')).toBe('PK\x03\x04');
      expect(buf.toString('utf8')).not.toContain('.DS_Store');
    }
  });
});
