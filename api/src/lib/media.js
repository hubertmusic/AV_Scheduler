import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import { HttpError, token } from './util.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

// Random name on disk, keeping a cleaned-up extension
export function newStoredName(original = '') {
  const ext = path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
  return `${Date.now()}-${token(12)}${ext}`;
}

const storage = multer.diskStorage({
  destination: config.uploadDir,
  filename: (req, file, cb) => cb(null, newStoredName(file.originalname || '')),
});

const maxBytes = config.maxUploadMB * 1024 * 1024;

// Accepts any file type up to the size limit. Files are always served with
// nosniff, and anything that could run in a browser is served as a download.
export function uploader({ field = 'files', maxCount = 20 } = {}) {
  const m = multer({ storage, limits: { fileSize: maxBytes, files: maxCount } });
  const handler = maxCount === 1 ? m.single(field) : m.array(field, maxCount);
  return (req, res, next) =>
    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `Files can be up to ${config.maxUploadMB} MB. For bigger videos, AirDrop or email them instead.`));
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return next(new HttpError(400, `Send up to ${maxCount} file${maxCount === 1 ? '' : 's'} at a time.`));
      next(err);
    });
}

export const filesOf = (req) => (req.files || (req.file ? [req.file] : []));

// Multer decodes names as latin1; restore UTF-8 (accents, curly quotes).
export function originalName(file) {
  try {
    return Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\r\n"\\/]/g, '_').slice(0, 200) || 'file';
  } catch {
    return 'file';
  }
}

export function removeUploads(files) {
  for (const f of files) fs.promises.unlink(f.path).catch(() => {});
}

export function deleteStored(storedName) {
  if (!storedName || storedName.includes('/') || storedName.includes('..')) return;
  fs.promises.unlink(path.join(config.uploadDir, storedName)).catch(() => {});
}

// ---------- archive (cold storage) ----------
// The archive folder must hold this file. If the NAS isn't mounted, the folder is just an
// empty directory on the local disk, so without the marker nothing is moved or looked up there.
export const ARCHIVE_MARKER = '.crewcall-archive';

export function archiveReady() {
  if (!config.archiveDir) return false;
  try {
    return fs.existsSync(path.join(config.archiveDir, ARCHIVE_MARKER));
  } catch {
    return false;
  }
}

const safeName = (n) => typeof n === 'string' && n && !n.includes('/') && !n.includes('\\') && !n.includes('..');

// Where a media file lives on disk ('' if it can't be known)
export function storedPath(m) {
  if (!safeName(m?.storedName)) return '';
  const dir = m.location === 'cold' ? config.archiveDir : config.uploadDir;
  return dir ? path.join(dir, m.storedName) : '';
}

// Delete a media record's file, wherever it lives
export function deleteMediaFile(m) {
  if (!m || m.purgedAt) return;
  const file = storedPath(m);
  if (file) fs.promises.unlink(file).catch(() => {});
}

export function fileHash(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')));
  });
}

// Why a stored file can't be read right now, or '' if it can
export function unavailableReason(m) {
  if (m.purgedAt) return 'it was removed to save space';
  if (m.location === 'cold' && !archiveReady()) return 'it’s in the archive on the NAS, which isn’t reachable right now';
  const file = storedPath(m);
  if (!file || !fs.existsSync(file)) return 'the file is missing from the server';
  return '';
}

// Copy a stored file to a new name in the uploads folder (for reusing it in another plan)
export async function copyStoredFile(m) {
  const why = unavailableReason(m);
  if (why) throw new HttpError(m.purgedAt ? 410 : m.location === 'cold' ? 503 : 404, why);
  const name = newStoredName(m.originalName);
  await fs.promises.copyFile(storedPath(m), path.join(config.uploadDir, name));
  return name;
}

const INLINE = /^(image\/(png|jpeg|gif|webp|heic|heif)|video\/(mp4|quicktime|webm)|audio\/.+|application\/pdf)$/;

export function sendStored(res, media, { download = false } = {}) {
  if (media.purgedAt) throw new HttpError(410, 'That file was removed to save space. The plan still lists it so you know it was used.');
  if (media.location === 'cold' && !archiveReady()) throw new HttpError(503, 'That file is in the archive on the NAS, which isn’t reachable right now. Try again once the NAS is back on.');
  const file = storedPath(media);
  if (!file || !fs.existsSync(file)) throw new HttpError(404, 'That file is missing from the server.');
  const inline = !download && INLINE.test(media.mime);
  const encoded = encodeURIComponent(media.originalName);
  res.set({
    'Content-Type': inline ? media.mime : media.mime === 'text/plain' ? 'text/plain; charset=utf-8' : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${media.originalName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encoded}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
    'Cache-Control': 'private, max-age=3600',
  });
  res.sendFile(file); // supports Range requests, so videos can be scrubbed
}

export function mediaView(m) {
  return {
    id: String(m._id),
    title: m.title || m.originalName,
    originalName: m.originalName,
    mime: m.mime,
    size: m.size,
    status: m.status,
    createdAt: m.createdAt,
    uploadedBy: m.uploadedBy?.name || null,
    uploadedById: m.uploadedBy ? String(m.uploadedBy._id || m.uploadedBy) : null,
    guestName: m.guest?.name || null,
    url: `/api/media/${m._id}/file`,
    library: !!m.library,
    category: m.category || '',
    // where the file is: 'hot' (ready), 'cold' (archive on the NAS) or 'removed' (deleted to save space)
    stored: m.purgedAt ? 'removed' : m.location === 'cold' ? 'cold' : 'hot',
  };
}
