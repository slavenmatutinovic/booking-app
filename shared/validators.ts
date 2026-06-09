import { z } from 'zod';
import { getUTCStartOfToday, isoDatetimeRegex, MAX_BOOKING_DAYS } from '../shared/index';

// Instanca polja usklađena sa Zod 4.4.3 standardom (koristi se parametar 'error')
export function isoDatetime(errorMsg: string) {
  return z
    .string({ error: errorMsg })
    .regex(isoDatetimeRegex, errorMsg) // ✅ POPRAVKA: Čist string bez objekta { message/error } uklanja deprecation!
    .transform((s: string) => new Date(s));
}

// Reusable Zod fragmenti za polja
export const isoDateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  error: 'Datum mora biti u formatu YYYY-MM-DD.',
});

/**
 * 🎯 UJEDINJENI REUSABLE REFINEMENT (Zod v4 Standard)
 * Jedinstveni algoritam koji u jednom prolazu proverava redosled datuma i maksimalno trajanje.
 * Rešava TS grešku sa 'input' poljem korišćenjem stabilne ctx.addIssue metode.
 */
export const validateBookingDatesRefinement = (
  data: { startDate?: Date; endDate?: Date },
  ctx: z.RefinementCtx,
  isRequest = false,
) => {
  const start = data.startDate;
  const end = data.endDate;

  // Kratak spoj: Ako datumi nisu učitani, prepuštamo primarnim validatorima iznad da bace grešku
  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
    return;
  }

  // 1. Provera redosleda datuma
  if (end.getTime() <= start.getTime()) {
    ctx.addIssue({
      code: 'custom',
      message: 'Datum odlaska mora biti posle datuma dolaska.',
      path: ['endDate'],
    });
    return;
  }

  // 2. Provera maksimalnog trajanja rezervacije / zahteva
  const diffMs = end.getTime() - start.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays > MAX_BOOKING_DAYS) {
    const entityName = isRequest ? 'Zahtev' : 'Rezervacija';
    ctx.addIssue({
      code: 'custom',
      message: `${entityName} ne može trajati duže od ${MAX_BOOKING_DAYS} dana.`,
      path: ['endDate'],
    });
  }
};

// =============================================================================
// 📝 MAKSIMALNO OPTIMIZOVANE I UJEDINJENE SHEME
// =============================================================================

// 📝 1. createBookingSchema
export const createBookingSchema = z
  .object({
    apartmentId: z
      .string({ message: 'ID apartmana je obavezan.' })
      .min(1, 'ID apartmana ne može biti prazan.'),

    guest: z
      .string({ message: 'Ime gosta mora biti tekst.' })
      .min(2, 'Ime gosta mora imati najmanje 2 karaktera.')
      .max(100, 'Ime gosta je predugačko.')
      .transform((s: string) => s.trim()),

    email: z
      .string({ message: 'Email je obavezan.' })
      .email({ error: 'Neispravan format email adrese.' })
      .max(255, 'Email je predugačak.')
      .transform((s: string) => s.trim().toLowerCase()),

    phone: z
      .string({ message: 'Broj telefona mora biti tekst.' })
      .max(30, 'Broj telefona je predugačak.')
      .optional(),

    startDate: isoDatetime(
      'startDate mora biti validan ISO 8601 string (npr. 2026-06-01T00:00:00.000Z)',
    ).refine(
      (date: Date) => {
        if (isNaN(date.getTime())) return false;
        const absolutePastThreshold = getUTCStartOfToday();
        absolutePastThreshold.setUTCHours(absolutePastThreshold.getUTCHours() - 12);
        return date >= absolutePastThreshold;
      },
      { message: 'Početni datum ne može biti u prošlosti.' }, // Zod v4 koristi { message } u .refine()
    ),

    endDate: isoDatetime('endDate mora biti validan ISO 8601 string.'),
  })
  .superRefine((data, ctx) => validateBookingDatesRefinement(data, ctx, false));

// 📝 2. updateBookingSchema
export const updateBookingSchema = z
  .object({
    apartmentId: z
      .string({ message: 'ID apartmana je obavezan.' })
      .min(1, 'ID apartmana ne može biti prazan.')
      .optional(),
    guest: z
      .string()
      .min(2, 'Ime gosta mora imati najmanje 2 karaktera.')
      .max(100, 'Ime gosta je predugačko.')
      .transform((s) => s.trim())
      .optional(),
    email: z
      .string()
      .email('Neispravan format email adrese.')
      .max(255, 'Email je predugačak.')
      .transform((s) => s.trim().toLowerCase())
      .optional(),
    phone: z.string().max(30, 'Broj telefona je predugačak.').nullable().optional(),
    startDate: isoDatetime('startDate mora biti validan ISO 8601 string.').optional(),
    endDate: isoDatetime('endDate mora biti validan ISO 8601 string.').optional(),
    status: z
      .enum(['CONFIRMED', 'CANCELLED'], {
        message: 'Status može biti samo CONFIRMED ili CANCELLED.',
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate) {
      validateBookingDatesRefinement(
        { startDate: data.startDate, endDate: data.endDate },
        ctx,
        false,
      );
    }
  });

// 📝 3. createGuestRequestSchema
export const createGuestRequestSchema = z
  .object({
    apartmentId: z
      .string({ message: 'ID apartmana je obavezan.' })
      .min(1, 'ID apartmana ne može biti prazan.'),

    guest: z
      .string({ message: 'Ime je obavezno.' })
      .min(2, 'Ime mora imati najmanje 2 karaktera.')
      .max(100, 'Ime je predugačko (max 100 karaktera).')
      .transform((s: string) => s.trim()),

    email: z
      .string({ message: 'Email je obavezan.' })
      .email('Neispravan format email adrese.')
      .max(255, 'Email je predugačak.')
      .transform((s: string) => s.trim().toLowerCase()),

    phone: z
      .string()
      .max(30, 'Broj telefona je predugačak.')
      .optional()
      .nullable()
      .transform((s: string | null | undefined) => s?.trim() || ''),

    startDate: isoDatetime(
      'startDate mora biti ISO 8601 string (npr. 2026-06-01T00:00:00.000Z).',
    ).refine(
      (date: Date) => {
        if (isNaN(date.getTime())) return false;
        const threshold = getUTCStartOfToday();
        threshold.setUTCHours(threshold.getUTCHours() - 12);
        return date >= threshold;
      },
      { message: 'Datum početka ne može biti u prošlosti.' },
    ),

    endDate: isoDatetime('endDate mora biti ISO 8601 string.'),
  })
  .superRefine((data, ctx) => validateBookingDatesRefinement(data, ctx, true));

// 📝 4. conditionalGuestSchema (Refleksija oblika bez trunke dupliranja stringova)
export const conditionalGuestSchema = z.object({
  guest: createBookingSchema.shape.guest,
  email: createBookingSchema.shape.email,
  phone: createBookingSchema.shape.phone,
});

// Izvoz čistih tipova za ceo monorepo (Frontend forme + Backend kontroleri)
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
export type CreateGuestRequestInput = z.infer<typeof createGuestRequestSchema>;
export type ConditionalGuestInput = z.infer<typeof conditionalGuestSchema>;
