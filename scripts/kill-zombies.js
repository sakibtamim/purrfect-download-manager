const { execSync } = require('child_process');
const os = require('os');

const isWin = os.platform() === 'win32';

const winProcesses = [
  'aria2c-x86_64-pc-windows-msvc.exe', 
  'yt-dlp-x86_64-pc-windows-msvc.exe', 
  'ffmpeg-x86_64-pc-windows-msvc.exe', 
  'aria2c.exe',
  'yt-dlp.exe',
  'ffmpeg.exe',
  'app.exe',
  'pdm.exe',
  'pdm-temp.exe'
];

const unixProcesses = [
  'aria2c', 
  'yt-dlp', 
  'ffmpeg', 
  'app',
  'pdm'
];

console.log("Terminating lingering background processes...");

try {
  if (isWin) {
    const args = winProcesses.map(p => `/IM ${p}`).join(' ');
    // Suppress output/errors as taskkill complains if processes don't exist
    execSync(`taskkill /F ${args} /T`, { stdio: 'ignore' });
  } else {
    const args = unixProcesses.join(' ');
    execSync(`killall -9 ${args}`, { stdio: 'ignore' });
  }
} catch {
  // Ignore errors
}

console.log("Clean complete. Safe to build!");
