// =============================================================================
// 📅 frontend/src/utils/dates.ts (Optimizovano pomoću date-fns)
// =============================================================================
/**
 * Bezbedno parsira "YYYY-MM-DD" string u Date objekat postavljen na čistu UTC ponoć.
 * ✅ Gwarantuje 100% konzistentno ponašanje u browseru bez timezone pomeranja!
 */

import { format, isToday as dateFnsIsToday } from 'date-fns';
import { sr } from 'date-fns/locale';
import { parseUTCDate } from '../../../shared/index';

export const parseDateStr = (dateInput: string | Date | undefined | null): Date =>
  parseUTCDate(dateInput);

/**
 * Formatira Date objekat nazad u čisti "YYYY-MM-DD" string izvlačeći isključivo UTC komponente.
 * ✅ Bezbedno od letnjeg/zimskog pomeranja vremena (DST-safe) prilikom slanja na API.
 */
export function formatDate(date: Date): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }

  // 🔒 Koristimo strict UTC gettere umesto lokalnih metoda da zaustavimo BUG-17
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

// Pomoćna funkcija: Bezbedno čupa YYYY-MM-DD deo iz datuma
export function cleanDateToIsoString(input: Date | string): string {
  if (typeof input === 'string') {
    // Ako je već ISO string ili sadrži vremensku zonu, izolujemo samo YYYY-MM-DD deo
    const cleanStr = input.split('T')[0] ?? '';
    // Ako string odgovara YYYY-MM-DD formatu, vraćamo ga direktno bez parsiranja
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanStr)) {
      return cleanStr;
    }
    const parsed = parseDateStr(cleanStr);
    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const day = String(parsed.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const year = input.getUTCFullYear();
  const month = String(input.getUTCMonth() + 1).padStart(2, '0');
  const day = String(input.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Re-eksportovanje vizuelnih date-fns funkcija za očuvanje kompatibilnosti ostatka aplikacije
export const isToday = (d: Date): boolean => dateFnsIsToday(d);
export const fmtDay = (d: Date): string => format(d, 'd');
export const fmtDayShort = (d: Date): string => format(d, 'EEE', { locale: sr });
export const fmtMonthYear = (d: Date): string => format(d, 'MMMM yyyy', { locale: sr });
export const fmtShort = (d: Date): string => format(d, 'd MMM', { locale: sr });
