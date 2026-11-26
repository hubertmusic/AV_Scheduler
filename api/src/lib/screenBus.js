// Tells the screens playing a live link about changes the moment they happen, over a connection
// each screen keeps open (server-sent events). Screens also check in every 10 seconds, so a screen
// that missed a message (or a browser without this) still catches up.
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(0);
let pending = null;

// Something on the screens may have changed: every screen fetches its playlist again (cheap; it
// only redraws if its own playlist is different). Bursts of changes go out as one.
export function screensChanged() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    bus.emit('msg', { t: 'change' });
  }, 150);
}
// Reload one screen's page now (like switching it off and on in Anthias)
export const restartScreen = (screenId) => bus.emit('msg', { t: 'restart', screen: String(screenId) });

export function listen(fn) {
  bus.on('msg', fn);
  return () => bus.off('msg', fn);
}
