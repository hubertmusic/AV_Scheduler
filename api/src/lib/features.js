// Extra features the admin can turn on in Settings → Extra features. Off until turned on.
import { getSettings, notFound, wrap } from './util.js';

export const FEATURES = ['liveShow', 'checklists', 'inputList', 'problems', 'debrief', 'signoffs'];

export async function featureOn(name) {
  const s = await getSettings();
  return !!s.features?.[name];
}

export const requireFeature = (name) =>
  wrap(async (req, res, next) => {
    if (!(await featureOn(name))) throw notFound('That feature is turned off. The admin can turn it on in Settings → Extra features.');
    next();
  });
