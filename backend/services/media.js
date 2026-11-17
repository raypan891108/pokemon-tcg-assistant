const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const storage = require('./storage');

// Photos and videos of the items in 賣場倉庫／網拍倉庫, kept in backend/data/media as
// <random id>.<ext>. The upload is the raw file as the request body (streamed to disk, not
// held in memory), with its name in the X-File-Name header.

const DIR = path.join(storage.dataDir, 'media');
const MAX_BYTES = 500 * 1024 * 1024;
const TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-m4v': '.m4v',
};
const FILE_RE = /^[a-f0-9]{24}\.[a-z0-9]{3,4}$/;
// Browsers send no type for some files (HEIC and MOV on Windows): go by the extension instead
const BY_EXTENSION = Object.fromEntries(Object.entries(TYPES).map(([mime, ext]) => [ext, mime]));
Object.assign(BY_EXTENSION, { '.jpeg': 'image/jpeg', '.qt': 'video/quicktime' });

function uploadError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function fileName(req) {
  let name = '';
  try {
    name = decodeURIComponent(String(req.get('X-File-Name') || ''));
  } catch {
    // A malformed name just isn't kept
  }
  return name.replace(/[\\/\r\n\t\0]/g, '').trim().slice(0, 120) || '未命名';
}

// Streams the request body to a new file; returns the entry to store on the item
async function save(req) {
  let mime = String(req.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!TYPES[mime]) mime = BY_EXTENSION[path.extname(fileName(req)).toLowerCase()] || mime;
  const ext = TYPES[mime];
  if (!ext) throw uploadError('只能上傳照片（JPG、PNG、WebP、GIF、HEIC）或影片（MP4、MOV、WebM）', 415);
  const declared = Number(req.get('Content-Length'));
  if (declared > MAX_BYTES) throw uploadError(`檔案太大，上限 ${MAX_BYTES / 1024 / 1024} MB`, 413);

  await fs.promises.mkdir(DIR, { recursive: true });
  const id = crypto.randomBytes(12).toString('hex');
  const file = `${id}${ext}`;
  const target = path.join(DIR, file);
  const tmp = `${target}.part`;

  const size = await new Promise((resolve, reject) => {
    let bytes = 0;
    let failed = false;
    const out = fs.createWriteStream(tmp);
    const fail = err => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      out.destroy();
      fs.promises.rm(tmp, { force: true }).finally(() => reject(err));
    };
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) fail(uploadError(`檔案太大，上限 ${MAX_BYTES / 1024 / 1024} MB`, 413));
    });
    req.on('aborted', () => fail(uploadError('上傳中斷')));
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => { if (!failed) resolve(bytes); });
    req.pipe(out);
  });
  if (!size) {
    await fs.promises.rm(tmp, { force: true });
    throw uploadError('檔案是空的');
  }
  await fs.promises.rename(tmp, target);

  return {
    id,
    file,
    kind: mime.startsWith('video/') ? 'video' : 'image',
    mime,
    name: fileName(req),
    size,
    uploadedAt: new Date().toISOString(),
  };
}

// Deletes files no longer used by any item (a split sale leaves two items sharing them)
async function removeUnused(files, items) {
  const used = new Set(items.flatMap(i => (i.media || []).map(m => m.file)));
  for (const file of files) {
    if (!used.has(file) && FILE_RE.test(file)) await fs.promises.rm(path.join(DIR, file), { force: true });
  }
}

// Full path of a stored file, or null for anything that isn't one
function pathOf(file) {
  return FILE_RE.test(String(file)) ? path.join(DIR, file) : null;
}

module.exports = { DIR, MAX_BYTES, save, removeUnused, pathOf };
