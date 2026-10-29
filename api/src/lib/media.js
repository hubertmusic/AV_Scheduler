import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import { HttpError, token } from './util.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: config.uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
    cb(null, `${Date.now()}-${token(12)}${ext}`);
  },
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

const INLINE = /^(image\/(png|jpeg|gif|webp|heic|heif)|video\/(mp4|quicktime|webm)|audio\/.+|application\/pdf)$/;

export function sendStored(res, media, { download = false } = {}) {
  const file = path.join(config.uploadDir, media.storedName);
  if (!fs.existsSync(file)) throw new HttpError(404, 'That file is missing from the server.');
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
    guestName: m.guest?.name || null,
    url: `/api/media/${m._id}/file`,
  };
}
