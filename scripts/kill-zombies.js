const { execSync } = require('child_process');

const targetProcesses = [
  'pdm-aria2c',
  'pdm-yt-dlp',
  'pdm-ffmpeg',
  'PurrfectDownloadManager'
];

console.log("Terminating lingering background processes...");

for (const proc of targetProcesses) {
  try {
    execSync(`killall -q -9 ${proc}`, { stdio: 'ignore' });
  } catch {
    // Process not running or killall not found; safe to ignore
  }
}

console.log("Clean complete. Safe to build!");
