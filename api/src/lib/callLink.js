// Call links: a WhatsApp call link (in WhatsApp: Calls → Create call link), a WhatsApp group invite,
// or a Zoom, Google Meet, Teams or FaceTime link. The call happens in that app; Crew Call only keeps
// the link so people can tap to join. Other sites are refused so a bad link can't be posted.
import { normalizeUrl, str } from './util.js';

const CALL_HOSTS = /(^|\.)(whatsapp\.com|wa\.me|zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|jit\.si|daily\.co|whereby\.com|facetime\.apple\.com)$/i;

// '' clears it; throws an Error with a message people can act on
export function readCallLink(raw) {
  const link = normalizeUrl(str(raw, 500));
  if (!link) return '';
  let host = '';
  try {
    const u = new URL(link);
    if (u.protocol !== 'https:') throw new Error();
    host = u.hostname;
  } catch {
    throw new Error('Paste the whole link, starting with https://');
  }
  if (!CALL_HOSTS.test(host)) throw new Error('Use a WhatsApp call link (in WhatsApp: Calls → Create call link), or a Zoom, Google Meet, Teams or FaceTime link.');
  return link;
}
