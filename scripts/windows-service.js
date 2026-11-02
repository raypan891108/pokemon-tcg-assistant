// Started by the Windows scheduled task that autostart.ps1 sets up: runs the site, restarts it
// if it crashes, appends its output to the log and keeps the PC awake while on AC power.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_DIR = path.join(__dirname, '..');
const STATE_DIR = path.join(process.env.LOCALAPPDATA, 'pokemon-tcg-assistant');
const LOG = path.join(STATE_DIR, 'pokemon-tcg-assistant.log');
const CONFIG = path.join(STATE_DIR, 'config.json');
const RESTART_DELAY_MS = 10_000;

fs.mkdirSync(STATE_DIR, { recursive: true });
const log = fs.openSync(LOG, 'a');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf-8'));
  } catch {
    return {};
  }
}

function runServer() {
  const { password } = readConfig();
  const env = { ...process.env };
  if (password) env.APP_PASSWORD = password;
  const child = spawn(process.execPath, [path.join(PROJECT_DIR, 'backend', 'server.js')], {
    cwd: PROJECT_DIR, env, stdio: ['ignore', log, log], windowsHide: true,
  });
  child.on('exit', (code, signal) => {
    fs.writeSync(log, `[Service] 網站已停止（${signal || code}），${RESTART_DELAY_MS / 1000} 秒後重新啟動\n`);
    setTimeout(runServer, RESTART_DELAY_MS);
  });
}

// Like caffeinate -s on the Mac: every minute, on AC power only, tell Windows the system is in use.
// It exits on its own once this process is gone.
function keepAwake() {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -Name Power -Namespace Win32 -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
    while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) {
      if ([System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus -eq 'Online') {
        [void][Win32.Power]::SetThreadExecutionState(1)
      }
      Start-Sleep -Seconds 60
    }`;
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'ignore', windowsHide: true,
  });
}

runServer();
keepAwake();
