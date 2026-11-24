// Digital signage: what each church screen shows, and getting uploads ready for screens.
// Pictures show for a number of seconds, videos play (made into a version every screen can play),
// PDFs are turned into a picture per page, and web pages show live.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { Screen, SignageAsset } from '../models.js';
import { newStoredName } from './media.js';
import { screensChanged } from './screenBus.js';

const run = promisify(execFile);

// ---------- who manages the screens ----------
// The admin, any team's head leader, and leaders given the Signage privilege on any team.
// The admin, every team's head leader, team leaders (unless it's been turned off for them), and
// anyone else the admin or a head leader has given it to, crew members included.
export function managesSignage(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!user.teams?.length) return user.role === 'leader' && !!user.perms?.signage;
  return user.teams.some((m) => m.head || !!m.perms?.signage);
}

// ---------- tools on the server ----------
const tools = { ffmpeg: false, ffprobe: false, pdftoppm: false };
export async function checkTools() {
  for (const [name, args] of [['ffmpeg', ['-version']], ['ffprobe', ['-version']], ['pdftoppm', ['-v']]]) {
    try {
      await run(name, args, { timeout: 10000 });
      tools[name] = true;
    } catch (e) {
      // pdftoppm -v prints its version and exits non-zero on some builds
      tools[name] = e.code !== 'ENOENT' && !!String(e.stderr || '').match(/pdftoppm|poppler/i);
    }
  }
  return tools;
}
export const toolsReady = () => ({ video: tools.ffmpeg && tools.ffprobe, pdf: tools.pdftoppm });

// ---------- what kind of file ----------
const IMAGE = /^image\/(png|jpeg|gif|webp|heic|heif|avif)$/;
const VIDEO = /^video\//;
export function kindOf(mime, name = '') {
  const ext = path.extname(name).toLowerCase();
  if (mime === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (IMAGE.test(mime) || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif'].includes(ext)) return 'image';
  if (VIDEO.test(mime) || ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'].includes(ext)) return 'video';
  return null;
}
export const NOT_SUPPORTED = 'Screens can show pictures, videos and PDFs. For PowerPoint, Word or Keynote, save it as a PDF first (File → Export → PDF), then send that.';

// ---------- files ----------
const inUploads = (name) => path.join(config.uploadDir, name);
export const assetFile = (a, page = null) => {
  const name = page === null ? a.storedName : a.pages[page];
  if (!name || name.includes('/') || name.includes('..')) return '';
  return inUploads(name);
};
export function deleteAssetFiles(a) {
  for (const n of [a.storedName, ...(a.pages || [])]) if (n && !n.includes('/') && !n.includes('..')) fs.promises.unlink(inUploads(n)).catch(() => {});
}
// Copy a stored file into a new signage asset's name (from a service plan's media)
export async function copyIntoSignage(fromPath, originalName) {
  const name = newStoredName(originalName);
  await fs.promises.copyFile(fromPath, inUploads(name));
  return name;
}

// ---------- getting uploads ready ----------
const queue = [];
let busy = false;
export function prepare(asset) {
  queue.push(String(asset._id));
  pump();
}
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const id = queue.shift();
    try {
      await prepareOne(id);
    } catch (e) {
      await SignageAsset.updateOne({ _id: id }, { processing: 'failed', processError: String(e.message || e).slice(0, 300) }).catch(() => {});
    }
    screensChanged(); // ready (or not): screens showing it pick it up now
  }
  busy = false;
  onPrepared?.();
}
let onPrepared = null;
export const whenPrepared = (fn) => (onPrepared = fn);

async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  const j = JSON.parse(stdout);
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  return { v, a, seconds: Math.round(Number(j.format?.duration) || Number(v?.duration) || 0), format: j.format?.format_name || '' };
}

async function prepareOne(id) {
  const a = await SignageAsset.findById(id);
  if (!a || a.processing !== 'working') return;
  const src = assetFile(a);
  if (!src || !fs.existsSync(src)) throw new Error('The file is missing from the server.');
  if (a.kind === 'pdf') {
    if (!tools.pdftoppm) throw new Error('This server can’t turn PDFs into pages yet (it needs the latest Crew Call update).');
    const base = newStoredName('x').replace(/\.[^.]*$/, '');
    await run('pdftoppm', ['-png', '-scale-to', '1920', '-l', '60', src, inUploads(base)], { timeout: 5 * 60000 });
    const pages = (await fs.promises.readdir(config.uploadDir)).filter((f) => f.startsWith(`${base}-`) && f.endsWith('.png')).sort((x, y) => Number(x.match(/-(\d+)\.png$/)[1]) - Number(y.match(/-(\d+)\.png$/)[1]));
    if (!pages.length) throw new Error('That PDF has no pages we could read.');
    a.pages = pages;
  } else if (a.kind === 'video') {
    if (!tools.ffmpeg || !tools.ffprobe) {
      a.processing = 'ready'; // keep it as it is; Anthias can usually play it
      await a.save();
      return;
    }
    const info = await probe(src);
    if (!info.v) throw new Error('That file doesn’t have any video in it.');
    const playable = info.v.codec_name === 'h264' && /mp4|mov/.test(info.format) && (info.v.height || 0) <= 1080 && (!info.v.pix_fmt || info.v.pix_fmt === 'yuv420p') && (!info.a || info.a.codec_name === 'aac');
    const out = newStoredName('video.mp4');
    // Plays on every screen: H.264 MP4, at most 1080p, starts streaming right away
    const args = playable
      ? ['-y', '-i', src, '-c', 'copy', '-movflags', '+faststart', inUploads(out)]
      : ['-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-vf', "scale='min(1920,iw)':-2,format=yuv420p", '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', inUploads(out)];
    await run('ffmpeg', args, { timeout: 30 * 60000, maxBuffer: 16 * 1024 * 1024 });
    fs.promises.unlink(src).catch(() => {});
    const stat = await fs.promises.stat(inUploads(out));
    a.storedName = out;
    a.mime = 'video/mp4';
    a.size = stat.size;
    a.videoSeconds = info.seconds;
  } else if (a.kind === 'image' && /heic|heif/i.test(a.mime)) {
    if (!tools.ffmpeg) throw new Error('This server can’t read iPhone HEIC photos. Send it as a JPEG (on iPhone: Settings → Camera → Formats → Most Compatible).');
    const out = newStoredName('photo.jpg');
    await run('ffmpeg', ['-y', '-i', src, '-q:v', '3', inUploads(out)], { timeout: 120000 });
    fs.promises.unlink(src).catch(() => {});
    a.storedName = out;
    a.mime = 'image/jpeg';
  }
  a.processing = 'ready';
  a.processError = '';
  await a.save();
}

// Anything left half-done when the server stopped
export async function resumePreparing() {
  const left = await SignageAsset.find({ processing: 'working' }, { _id: 1 }).lean();
  for (const a of left) prepare(a);
}

// ---------- what shows where ----------
export const onScreen = (a, screenId) => !a.screens?.length || a.screens.some((s) => String(s) === String(screenId));
// Showing right now: approved, ready, switched on, and inside its dates
export function isLive(a, now = new Date()) {
  return a.status === 'approved' && a.processing === 'ready' && a.enabled && (!a.startAt || a.startAt <= now) && (!a.endAt || a.endAt > now);
}
export async function playlistFor(screen, now = new Date()) {
  const all = await SignageAsset.find({ status: 'approved', processing: 'ready', enabled: true }).sort({ order: 1, createdAt: 1 }).lean();
  return all.filter((a) => onScreen(a, screen._id) && isLive(a, now));
}

// The playlist a screen's player gets. fileUrl(asset, page) builds the link to each file.
export function playerItems(list, screen, fileUrl) {
  const out = [];
  for (const a of list) {
    // 0 on a picture, page or web page: it stays on screen (the screen doesn't move on from it)
    const seconds = a.seconds === 0 ? 0 : a.seconds > 0 ? a.seconds : screen.seconds || 10;
    if (a.kind === 'pdf') a.pages.forEach((p, i) => out.push({ id: `${a._id}:${i}`, kind: 'image', url: fileUrl(a, i), seconds, name: `${a.name} (page ${i + 1})` }));
    else if (a.kind === 'web') out.push({ id: String(a._id), kind: 'web', url: a.uri, seconds, name: a.name });
    else if (a.kind === 'video') out.push({ id: String(a._id), kind: 'video', url: fileUrl(a), seconds: a.seconds > 0 ? a.seconds : 0, sound: !!a.sound, name: a.name });
    else out.push({ id: String(a._id), kind: 'image', url: fileUrl(a), seconds, name: a.name });
  }
  return out;
}
// Changes when the playlist would change, so players only reload when they need to
export const playlistVersion = (items, screen) => crypto.createHash('sha1').update(JSON.stringify([screen.fit, screen.seconds, !!screen.off, items.map((i) => [i.id, i.url, i.seconds, i.sound])])).digest('hex').slice(0, 16);

export async function nextOrder() {
  const last = await SignageAsset.findOne({}, { order: 1 }).sort({ order: -1 }).lean();
  return (last?.order || 0) + 1;
}

export const screenLink = (s) => `${config.publicUrl}/screen/${s.token}`;
export async function screensList() {
  return Screen.find().sort({ order: 1, createdAt: 1 }).lean();
}
