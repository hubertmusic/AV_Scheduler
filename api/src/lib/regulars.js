import { DateTime } from 'luxon';
import { addDays, DATE_RE, str } from './util.js';

// A regular commitment: "Ava serves the 2nd Sabbath of every month at Worship Service,
// in whichever of her positions is open." Weeks are counted by the weekend's Sabbath.
export const WEEKS = ['every', '1', '2', '3', '4', '5', 'last', 'alt'];

export function matchesWeek(rule, friday) {
  const sab = DateTime.fromISO(addDays(friday, 1));
  const nth = Math.ceil(sab.day / 7);
  switch (rule.week) {
    case 'every':
      return true;
    case 'last':
      return sab.plus({ days: 7 }).month !== sab.month;
    case 'alt': {
      if (!DATE_RE.test(rule.anchor || '')) return false;
      const weeks = Math.round(DateTime.fromISO(friday).diff(DateTime.fromISO(rule.anchor), 'days').days / 7);
      return weeks % 2 === 0;
    }
    default:
      return nth === Number(rule.week);
  }
}

export function cleanRegulars(list, positionKeys) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 12).map((r) => {
    const week = WEEKS.includes(r?.week) ? r.week : 'every';
    return {
      week,
      anchor: week === 'alt' && DATE_RE.test(r.anchor || '') ? r.anchor : '',
      service: str(r?.service, 80),
      positions: Array.isArray(r?.positions) ? [...new Set(r.positions.filter((k) => positionKeys.has(k)))] : [],
      note: str(r?.note, 120),
    };
  });
}

export function describeWeek(rule) {
  const ord = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th' };
  if (rule.week === 'every') return 'Every weekend';
  if (rule.week === 'last') return 'Last Sabbath of the month';
  if (rule.week === 'alt') return 'Every other weekend';
  return `${ord[rule.week]} Sabbath of the month`;
}
