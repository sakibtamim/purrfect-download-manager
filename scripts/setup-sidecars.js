const fs = require('fs');
const https = require('https');
const path = require('path');

const binDir = path.resolve(__dirname, '../src-tauri/bin');

if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
}

// Map of sidecar binaries
const sidecarTargets = [
  // yt-dlp
  { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', name: 'yt-dlp-x86_64-pc-windows-msvc.exe' },
  { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos', name: 'yt-dlp-x86_64-apple-darwin' },
  { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos', name: 'yt-dlp-aarch64-apple-darwin' },
  { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', name: 'yt-dlp-x86_64-unknown-linux-gnu' },
  { url: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64', name: 'yt-dlp-aarch64-unknown-linux-gnu' },
  
  // ffmpeg
  { url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/win32-x64', name: 'ffmpeg-x86_64-pc-windows-msvc.exe' },
  { url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/darwin-x64', name: 'ffmpeg-x86_64-apple-darwin' },
  { url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/darwin-arm64', name: 'ffmpeg-aarch64-apple-darwin' },
  { url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/linux-x64', name: 'ffmpeg-x86_64-unknown-linux-gnu' },
  { url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b4.4/linux-arm64', name: 'ffmpeg-aarch64-unknown-linux-gnu' },
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
        console.log(`[DONE] ${path.basename(destPath)}`);
        // Make executable on unix
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

async function main() {
  console.log("Setting up Tauri sidecars...");
  for (const target of sidecarTargets) {
    try {
      await downloadFile(target.url, path.join(binDir, target.name));
    } catch (e) {
      console.error(`Failed to download ${target.name}:`, e.message);
    }
  }
  
  // Note: For aria2c macOS/Linux, you must manually place the static binaries in src-tauri/bin/ 
  // since reliable single-file static releases are not universally hosted.
  console.log("Setup complete!");
}

main();
