// =============================================================================
// 🗄️ backend/src/utils/dateUtils.ts (Optimizovano pomoću date-fns u UTC duhu)
// =============================================================================
import { differenceInDays } from 'date-fns';

/**
 * Vraća početak današnjeg dana u čistom UTC-u. DST-safe.
 */
export function getUTCStartOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Vraća apsolutni početak i kraj datog kalendarskog meseca u UTC-u.
 * Koristi matematički bezbedne UTC graničnike kompatibilne sa findMany upitima.
 */
export function getUTCMonthRange(year: number, month: number): { start: Date; end: Date } {
  return {
    // Prvi dan u mesecu u 00:00:00
    start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    // Poslednji dan u mesecu (dan 0 sledećeg meseca) u 23:59:59
    end: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  };
}

/**
 * Normalizuje bilo koji Date objekat na čistu UTC ponoć (00:00:00.000Z).
 * Obavezno izvršiti pre prisma upisa u bazu za startDate/endDate rezervacija.
 */
export function normalizeToUTCMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
}

/**
 * Izračunava tačan broj noćenja između dve UTC ponoći pomoću date-fns logike.
 */
export function calcNightsUTC(start: Date, end: Date): number {
  const cleanStart = normalizeToUTCMidnight(start);
  const cleanEnd = normalizeToUTCMidnight(end);

  // differenceInDays iz date-fns radi matematički proračun razlike epoha
  return differenceInDays(cleanEnd, cleanStart);
}

export function parseStringToUTCDate(input: unknown): Date {
  // ✅ DODATO: Ako je ulaz već Date objekat, samo ga izvlačimo i normalizujemo
  if (input instanceof Date) {
    if (isNaN(input.getTime())) {
      throw new Error('INVALID_DATE_OBJECT');
    }
    return new Date(
      Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate(), 0, 0, 0, 0),
    );
  }

  if (typeof input !== 'string') {
    throw new Error('INVALID_DATE_INPUT');
  }

  // Ostatak logike sa .split('T') ostaje isti...
  const cleanStr = input.split('T')[0] ?? '';
  const parts = cleanStr.split('-');
  if (parts.length !== 3) {
    throw new Error('INVALID_DATE_FORMAT');
  }

  const year = parseInt(parts[0] ?? '0', 10);
  const month = parseInt(parts[1] ?? '0', 10);
  const day = parseInt(parts[2] ?? '0', 10);

  if (isNaN(year) || isNaN(month) || isNaN(day) || year === 0 || month === 0 || day === 0) {
    throw new Error('INVALID_DATE_COMPONENTS');
  }

  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}
