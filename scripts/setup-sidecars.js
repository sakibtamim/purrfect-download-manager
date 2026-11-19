const fs = require('fs');
const https = require('https');
const path = require('path');
const { execSync } = require('child_process');

const binDir = path.resolve(__dirname, '../src-tauri/bin');

if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

// Map of sidecar binaries for Linux (EndeavourOS / Arch Linux focus)
const sidecarTargets = [
  // yt-dlp
  { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', name: 'pdm-yt-dlp-x86_64-unknown-linux-gnu' },
  { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64', name: 'pdm-yt-dlp-aarch64-unknown-linux-gnu' },
  
  // ffmpeg
  { url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/linux-x64', name: 'pdm-ffmpeg-x86_64-unknown-linux-gnu' },
  { url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/linux-arm64', name: 'pdm-ffmpeg-aarch64-unknown-linux-gnu' },

  // aria2c
  { 
    url: 'https://github.com/P3TERX/Aria2-Pro-Core/releases/download/1.36.0_2021.08.22/aria2-1.36.0-static-linux-amd64.tar.gz', 
    name: 'pdm-aria2c-x86_64-unknown-linux-gnu',
    archive: true,
    extractPath: 'aria2c'
  },
  { 
    url: 'https://github.com/P3TERX/Aria2-Pro-Core/releases/download/1.36.0_2021.08.22/aria2-1.36.0-static-linux-arm64.tar.gz', 
    name: 'pdm-aria2c-aarch64-unknown-linux-gnu',
    archive: true,
    extractPath: 'aria2c'
  }
];

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(destPath)) {
      console.log(`[SKIP] ${path.basename(destPath)} already exists.`);
      return resolve();
    }

    console.log(`[DOWNLOADING] ${url} -> ${path.basename(destPath)}`);
    const file = fs.createWriteStream(destPath);
    
    https.get(url, function responseHandler(res) {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return https.get(res.headers.location, responseHandler).on('error', reject);
      }
      
      if (res.statusCode !== 200) {
        fs.unlink(destPath, () => {});
        return reject(new Error(`Status Code: ${res.statusCode}`));
      }

      res.pipe(file);
      file.on('finish', () => {
        file.close();
        if (!destPath.endsWith('.exe')) {
          fs.chmodSync(destPath, 0o755);
        }
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function processTarget(target) {
  const destPath = path.join(binDir, target.name);
  if (fs.existsSync(destPath)) {
    console.log(`[SKIP] ${target.name} already exists.`);
    return Promise.resolve();
  }

  if (!target.archive) {
    return downloadFile(target.url, destPath).then(() => {
      console.log(`[DONE] ${target.name}`);
    });
  }

  const tempArchive = path.join(binDir, 'temp_' + target.name + path.extname(target.url));
  return downloadFile(target.url, tempArchive).then(() => {
    console.log(`[EXTRACTING] ${target.name}`);
    try {
      if (target.url.endsWith('.tar.gz')) {
        execSync(`tar -xzf "${path.basename(tempArchive)}" "${target.extractPath}"`, { cwd: binDir });
      } else if (target.url.endsWith('.zip')) {
        if (process.platform === 'win32') {
          execSync(`powershell -Command "Expand-Archive -Path '${path.basename(tempArchive)}' -DestinationPath '.' -Force"`, { cwd: binDir });
        } else {
          execSync(`unzip -o "${path.basename(tempArchive)}" "${target.extractPath}"`, { cwd: binDir });
        }
      }
      const extractedFile = path.join(binDir, target.extractPath);
      fs.renameSync(extractedFile, destPath);
      fs.unlinkSync(tempArchive);
      
      const parentDir = path.dirname(extractedFile);
      if (parentDir !== binDir && fs.existsSync(parentDir)) {
        fs.rmSync(parentDir, { recursive: true, force: true });
      }
      
      if (!destPath.endsWith('.exe')) fs.chmodSync(destPath, 0o755);
      console.log(`[DONE] ${target.name}`);
    } catch (e) {
      if (fs.existsSync(tempArchive)) fs.unlinkSync(tempArchive);
      throw e;
    }
  });
}

async function main() {
  console.log("Setting up Tauri sidecars for Linux...");
  const platform = process.platform;
  const arch = process.arch;

  if (platform !== 'linux') {
    console.log("[INFO] PDM is currently focused solely on Linux (EndeavourOS / Arch Linux). Skipping non-Linux platforms.");
    return;
  }

  const targetTriple = arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';

  for (const target of sidecarTargets) {
    if (!target.name.includes(targetTriple)) {
      continue;
    }
    try {
      await processTarget(target);
    } catch (e) {
      console.error(`Failed to setup ${target.name}:`, e.message);
    }
  }

  // Also mirror to src-tauri/target/debug if directory exists (for immediate tauri dev execution)
  const targetDebugDir = path.resolve(__dirname, '../src-tauri/target/debug');
  if (fs.existsSync(targetDebugDir)) {
    const mappings = [
      { src: `pdm-aria2c-${targetTriple}`, dest: 'pdm-aria2c' },
      { src: `pdm-ffmpeg-${targetTriple}`, dest: 'pdm-ffmpeg' },
      { src: `pdm-yt-dlp-${targetTriple}`, dest: 'pdm-yt-dlp' }
    ];
    for (const m of mappings) {
      const srcPath = path.join(binDir, m.src);
      const destPath = path.join(targetDebugDir, m.dest);
      if (fs.existsSync(srcPath)) {
        try {
          fs.copyFileSync(srcPath, destPath);
          fs.chmodSync(destPath, 0o755);
          console.log(`[MIRROR] ${m.dest} copied to target/debug`);
        } catch (err) {
          if (err.code === 'ETXTBSY') {
            console.log(`[INFO] ${m.dest} is currently running in target/debug (skipped active process).`);
          } else {
            console.warn(`[WARN] Could not mirror ${m.dest}:`, err.message);
          }
        }
      }
    }
  }

  console.log("Setup complete!");
}

main();
