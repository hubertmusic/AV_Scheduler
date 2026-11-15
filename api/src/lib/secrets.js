// Encryption for the team vaults and personal notes. AES-256-GCM with a key from VAULT_KEY (or,
// if that's empty, one made from JWT_SECRET). The database and its backups only ever hold
// encrypted text; the key lives in the server's .env.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { Note, Settings, VaultEntry } from '../models.js';

const derive = (secret, label) => crypto.createHash('sha256').update(`${label}:${secret}`).digest();
const fromVaultKey = () => (config.vaultKey ? (/^[0-9a-f]{64}$/i.test(config.vaultKey) ? Buffer.from(config.vaultKey, 'hex') : derive(config.vaultKey, 'crew-call-vault-key')) : null);
const fromJwt = () => derive(config.jwtSecret, 'crew-call-vault');
let KEY = fromVaultKey() || fromJwt();
let broken = false; // the key doesn't match what the vault was saved with
export const vaultKeyFromEnv = () => Boolean(config.vaultKey);
export const vaultBroken = () => broken;

const CHECK = 'crew-call-vault-check';
function enc(text, key = KEY) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')}`;
}
function dec(stored, key = KEY) {
  if (!stored) return '';
  if (!stored.startsWith('v1:')) return stored;
  const raw = Buffer.from(stored.slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
export const seal = (text) => enc(text);
export function open(stored) {
  if (broken) throw Object.assign(new Error('The vault key changed, so saved secrets can’t be read. Put the old VAULT_KEY back in .env.'), { status: 503 });
  return dec(stored);
}

// At start-up: remember a check value; if VAULT_KEY was just added, move everything from the
// JWT-based key to it; if the key is simply wrong, keep the vault closed rather than show garbage.
export async function ensureVaultKey() {
  const s = await Settings.findOne({ key: 'main' });
  if (!s) return;
  if (!s.vaultCheck) {
    s.vaultCheck = enc(CHECK);
    await s.save();
    return;
  }
  const ok = (key) => {
    try {
      return dec(s.vaultCheck, key) === CHECK;
    } catch {
      return false;
    }
  };
  if (ok(KEY)) return;
  const old = fromJwt();
  if (config.vaultKey && ok(old)) {
    const move = (v) => (v ? enc(dec(v, old)) : v);
    for (const e of await VaultEntry.find({})) {
      e.username = move(e.username);
      e.secret = move(e.secret);
      e.notes = move(e.notes);
      await e.save();
    }
    for (const n of await Note.find({})) {
      n.body = move(n.body);
      await n.save();
    }
    s.vaultCheck = enc(CHECK);
    await s.save();
    console.log('Moved the vault and notes to the new VAULT_KEY.');
    return;
  }
  broken = true;
  console.error('VAULT_KEY doesn’t match the key the vault was saved with. The vault and notes stay closed until the old key is back.');
}
