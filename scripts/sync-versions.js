const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

function syncVersions(rootDir = path.join(__dirname, '..'), options = {}) {
  const { updateCargoLock = true } = options;

  const pkgPath = path.join(rootDir, 'package.json');
  const tauriConfPath = path.join(rootDir, 'src-tauri/tauri.conf.json');
  const cargoTomlPath = path.join(rootDir, 'src-tauri/Cargo.toml');
  const pkgbuildPath = path.join(rootDir, 'packaging/archlinux/PKGBUILD');
  const extensionManifestPath = path.join(rootDir, 'extension/manifest.json');

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = pkg.version;

  // 1. Update tauri.conf.json
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  if (tauriConf.version) {
    tauriConf.version = version;
    fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
    console.log(`[sync-versions] Updated tauri.conf.json to version ${version}`);
  }

  // 2. Update Cargo.toml
  let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
  // Matches the first 'version = "..."' which belongs to the [package] section
  cargoToml = cargoToml.replace(/^version *= *".*"/m, `version = "${version}"`);
  fs.writeFileSync(cargoTomlPath, cargoToml);
  console.log(`[sync-versions] Updated Cargo.toml to version ${version}`);

  // 3. Update Cargo.lock
  if (updateCargoLock) {
    try {
      console.log(`[sync-versions] Updating Cargo.lock...`);
      childProcess.execSync('cargo update -p purrfect-download-manager --offline', {
        cwd: path.join(rootDir, 'src-tauri'),
        stdio: 'inherit'
      });
      console.log(`[sync-versions] Updated Cargo.lock successfully.`);
    } catch {
      console.log('[sync-versions] Failed to automatically update Cargo.lock');
    }
  }

  // 4. Update packaging/archlinux/PKGBUILD
  if (fs.existsSync(pkgbuildPath)) {
    let pkgbuild = fs.readFileSync(pkgbuildPath, 'utf8');
    pkgbuild = pkgbuild.replace(/^pkgver=.*$/m, `pkgver=${version}`);
    fs.writeFileSync(pkgbuildPath, pkgbuild);
    console.log(`[sync-versions] Updated packaging/archlinux/PKGBUILD to version ${version}`);
  }

  // 5. Update extension/manifest.json
  if (fs.existsSync(extensionManifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(extensionManifestPath, 'utf8'));
    manifest.version = version;
    fs.writeFileSync(extensionManifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`[sync-versions] Updated extension/manifest.json to version ${version}`);
  }

  return version;
}

if (require.main === module) { // agyis: no-mutant CLI entrypoint guard
  syncVersions(); // agyis: no-mutant CLI entrypoint guard
}

module.exports = { syncVersions };
