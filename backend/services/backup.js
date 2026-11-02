const fs = require('fs');
const os = require('os');
const path = require('path');
const storage = require('./storage');

// Your own records; scraped data is re-fetched and doesn't need a backup
const FILES = ['inventory.json', 'watchlist.json', 'settings.json'];
const KEEP = 30;

// A synced cloud folder when there is one (iCloud Drive on a Mac, OneDrive on Windows), otherwise Documents
function defaultBackupDir() {
  const cloud = process.platform === 'win32'
    ? process.env.OneDrive
    : path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs');
  return path.join(cloud && fs.existsSync(cloud) ? cloud : path.join(os.homedir(), 'Documents'), 'TCG助手備份');
}

const BACKUP_DIR = process.env.BACKUP_DIR || defaultBackupDir();

// One folder per day, named YYYY-MM-DD in local time
const today = () => new Date().toLocaleDateString('sv-SE');

async function listBackups() {
  try {
    const names = await fs.promises.readdir(BACKUP_DIR);
    return names.filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

// Copy the records into today's folder (replacing an earlier copy from today) and keep the last 30 days
async function backupNow() {
  const dir = path.join(BACKUP_DIR, today());
  await fs.promises.mkdir(dir, { recursive: true });
  const copied = [];
  for (const file of FILES) {
    const src = path.join(storage.dataDir, file);
    if (!fs.existsSync(src)) continue;
    await fs.promises.copyFile(src, path.join(dir, file));
    copied.push(file);
  }
  const backups = await listBackups();
  for (const old of backups.slice(0, Math.max(backups.length - KEEP, 0))) {
    await fs.promises.rm(path.join(BACKUP_DIR, old), { recursive: true, force: true });
  }
  console.log(`[Backup] ${copied.length} file(s) → ${dir}`);
  return { dir, files: copied };
}

// Called after every scheduled fetch; backs up at most once a day
async function backupIfDue() {
  const backups = await listBackups();
  if (backups[backups.length - 1] === today()) return null;
  return backupNow();
}

async function getStatus() {
  const backups = await listBackups();
  const latest = backups[backups.length - 1] || null;
  // Newest file inside the folder (replacing files doesn't touch the folder's own time)
  let latestAt = null;
  if (latest) {
    const dir = path.join(BACKUP_DIR, latest);
    const files = await fs.promises.readdir(dir).catch(() => []);
    const times = await Promise.all(files.map(f => fs.promises.stat(path.join(dir, f)).then(s => s.mtimeMs, () => 0)));
    if (times.length) latestAt = new Date(Math.max(...times)).toISOString();
  }
  return { dir: BACKUP_DIR, count: backups.length, keep: KEEP, latest, latestAt };
}

module.exports = { backupNow, backupIfDue, getStatus };
