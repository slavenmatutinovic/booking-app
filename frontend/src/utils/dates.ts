// =============================================================================
// 📅 frontend/src/utils/dates.ts (Optimizovano pomoću date-fns)
// =============================================================================
import { format, parse, isToday as dateFnsIsToday } from 'date-fns';
import { sr } from 'date-fns/locale';

/**
 * Bezbedno parsira "YYYY-MM-DD" string u lokalni Date objekat.
 * Gwarantuje konzistentno ponašanje u browseru bez timezone pomeranja.
 */
export function parseDateStr(str: string): Date {
  // Ako string sadrži T (ISO format), uzimamo samo YYYY-MM-DD deo
  const cleanStr = str.split('T')[0] ?? '';
  return parse(cleanStr, 'yyyy-MM-dd', new Date());
}

/**
 * Formatira lokalni Date objekat nazad u čisti "YYYY-MM-DD" string za API payload.
 */
export function formatDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

// Re-eksportovanje date-fns funkcija za očuvanje kompatibilnosti ostatka aplikacije
export const isToday = (d: Date): boolean => dateFnsIsToday(d);
export const fmtDay = (d: Date): string => format(d, 'd');
export const fmtDayShort = (d: Date): string => format(d, 'EEE', { locale: sr });
export const fmtMonthYear = (d: Date): string => format(d, 'MMMM yyyy', { locale: sr });
export const fmtShort = (d: Date): string => format(d, 'd MMM', { locale: sr });
