const fs = require('fs');
const path = require('path');

const pkgPath = path.join(__dirname, '../package.json');
const tauriConfPath = path.join(__dirname, '../src-tauri/tauri.conf.json');
const cargoTomlPath = path.join(__dirname, '../src-tauri/Cargo.toml');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;

// Update tauri.conf.json
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
if (tauriConf.version) {
  tauriConf.version = version;
  fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
  console.log(`[sync-versions] Updated tauri.conf.json to version ${version}`);
}

// Update Cargo.toml
let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
// Matches the first 'version = "..."' which belongs to the [package] section
cargoToml = cargoToml.replace(/version = ".*"/, `version = "${version}"`);
fs.writeFileSync(cargoTomlPath, cargoToml);
console.log(`[sync-versions] Updated Cargo.toml to version ${version}`);
