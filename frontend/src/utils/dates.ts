// =============================================================================
// SEKCIJA 2 — DATUM UTILITY FUNKCIJE
// =============================================================================
import { format } from 'date-fns';

import { sr } from 'date-fns/locale';
export function parseDateStr(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export { isToday } from 'date-fns';
export const fmtDay = (d: Date): string => format(d, 'd');
export const fmtDayShort = (d: Date): string => format(d, 'EEE', { locale: sr });
export const fmtMonthYear = (d: Date): string => format(d, 'MMMM yyyy', { locale: sr });
export const fmtShort = (d: Date): string => format(d, 'd MMM');
