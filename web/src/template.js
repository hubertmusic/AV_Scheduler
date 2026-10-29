import { api } from './lib.js';

// Builds (or tops up) a weekend from the Settings template. If services already on the
// weekend no longer match the template, or aren't in it any more, asks what to do with them.
export async function buildFromTemplate(app, friday) {
  const r = await api('/events/weekend', { method: 'POST', body: { friday } });
  let s = { updated: 0, cleared: 0, removed: 0 };
  if (r.differs?.length || r.extra?.length) {
    const choice = await app.openSync({ friday, differs: r.differs || [], extra: r.extra || [] });
    if (choice && (choice.syncIds.length || choice.remove.length)) {
      s = await api('/events/weekend', { method: 'POST', body: { friday, sync: true, syncIds: choice.syncIds, remove: choice.remove } });
    }
  }
  const parts = [];
  if (r.created) parts.push(`added ${r.created} service${r.created === 1 ? '' : 's'}`);
  if (s.updated) parts.push(`updated ${s.updated} to match`);
  if (s.removed) parts.push(`removed ${s.removed}`);
  if (s.cleared) parts.push(`took ${s.cleared} ${s.cleared === 1 ? 'person' : 'people'} off removed positions`);
  app.toast(parts.length ? `Template: ${parts.join(', ')}` : r.differs?.length || r.extra?.length ? 'Nothing changed' : 'This weekend already matches your template');
  return { created: r.created, updated: s.updated, removed: s.removed };
}
