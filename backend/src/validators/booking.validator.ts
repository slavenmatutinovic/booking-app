// backend/src/validators/booking.validator.ts
import { z } from 'zod';
import { MAX_BOOKING_DAYS } from '../../../shared/index';

// Regex koji prihvata validan ISO 8601 UTC datetime string
// Primeri: 2026-06-01T00:00:00.000Z  ili  2026-06-01T12:30:00Z
const isoDatetimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isoDatetime(errorMsg: string) {
  return z
    .string()
    .regex(isoDatetimeRegex, errorMsg)
    .transform((s) => new Date(s));
}

const getStartOfToday = (): Date => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

export const createBookingSchema = z
  .object({
    apartmentId: z
      .string({ error: 'ID apartmana je obavezan i mora biti tekst' })
      .min(1, { error: 'ID apartmana je obavezan' }),

    guest: z
      .string({ error: 'Ime gosta je obavezno i mora biti tekst' })
      .min(2, { error: 'Ime gosta mora imati najmanje 2 karaktera' })
      .max(100, { error: 'Ime gosta je predugačko' })
      .transform((s) => s.trim()), // ← Sanitizacija: ukloni whitespace

    email: z
      .string({ error: 'Email adresa je obavezna' })
      .check(z.email({ error: 'Neispravan format email adrese' }))
      .max(255, { error: 'Email je predugačak' })
      .transform((s) => s.trim().toLowerCase()), // ← Normalizacija

    phone: z
      .string({ error: 'Broj telefona mora biti tekst' })
      .max(30, { error: 'Broj telefona je predugačak' })
      .optional()
      .nullable()
      .default(''),

    startDate: isoDatetime(
      'startDate mora biti validan ISO 8601 string (npr. 2026-06-01T00:00:00.000Z)',
    ).refine(
      (date) => {
        const absolutePastThreshold = getStartOfToday();
        absolutePastThreshold.setHours(absolutePastThreshold.getHours() - 12);
        return date >= absolutePastThreshold;
      },
      { message: 'Početni datum ne može biti u prošlosti' },
    ),

    endDate: isoDatetime('endDate mora biti validan ISO 8601 string'),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: 'Datum odlaska mora biti posle datuma dolaska',
    path: ['endDate'],
  })
  .refine(
    (data) => {
      const diffTime = Math.abs(data.endDate.getTime() - data.startDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays <= MAX_BOOKING_DAYS;
    },
    {
      message: `Rezervacija ne može trajati duže od ${MAX_BOOKING_DAYS} dana`,
      path: ['endDate'],
    },
  );

export const updateBookingSchema = z
  .object({
    apartmentId: z.string({ message: 'Nevažeći ID apartmana.' }).optional(),
    guest: z
      .string({ message: 'Ime gosta mora biti tekst' })
      .min(2, { error: 'Ime gosta mora imati najmanje 2 karaktera' })
      .max(100, { error: 'Ime gosta je predugačko' })
      .transform((s) => s.trim()) // ← Sanitizacija: ukloni whitespace
      .optional(),

    email: z
      .string({ error: 'Email mora biti tekst' })
      .check(z.email({ error: 'Neispravan format email adrese' }))
      .max(255, { error: 'Email je predugačak' })
      .transform((s) => s.trim().toLowerCase()) // ← Normalizacija
      .optional(),

    phone: z
      .string({ error: 'Broj telefona mora biti tekst' })
      .max(30, { error: 'Broj telefona je predugačak' })
      .nullable()
      .optional(),

    startDate: isoDatetime(
      'startDate mora biti validan ISO 8601 string (npr. 2026-06-01T00:00:00.000Z)',
    ).optional(),

    endDate: isoDatetime(
      'endDate mora biti validan ISO 8601 string (npr. 2026-06-01T00:00:00.000Z)',
    ).optional(),

    status: z
      .enum(['CONFIRMED', 'CANCELLED'], {
        error: 'Status može biti samo CONFIRMED ili CANCELLED',
      })
      .optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return data.endDate > data.startDate;
      }
      return true;
    },
    { error: 'Datum odlaska mora biti posle datuma dolaska', path: ['endDate'] },
  )
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        const diffTime = Math.abs(data.endDate.getTime() - data.startDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays <= MAX_BOOKING_DAYS;
      }
      return true;
    },
    { error: `Rezervacija ne može trajati duže od ${MAX_BOOKING_DAYS} dana`, path: ['endDate'] },
  );

/**
 * Šema za zahtev gosta (javni endpoint POST /api/bookings/requests).
 *
 * Razlike od createBookingSchema:
 *   - Nema provere da startDate nije u prošlosti (admin može pregledati stare zahteve)
 *   - Striktna sanitizacija guest i email polja zbog XSS rizika
 *   - Blago opušteniji limit na dužinu (gosti ne znaju za limit od 2 karaktera)
 */
export const createGuestRequestSchema = z
  .object({
    apartmentId: z
      .string({ error: 'ID apartmana je obavezan' })
      .min(1, { error: 'ID apartmana je obavezan' }),

    guest: z
      .string({ error: 'Ime je obavezno' })
      .min(2, { error: 'Ime mora imati najmanje 2 karaktera' })
      .max(100, { error: 'Ime je predugačko (max 100 karaktera)' })
      .transform((s) => s.trim()), // ← Sanitizacija: ukloni whitespace

    email: z
      .string({ error: 'Email adresa je obavezna' })
      .check(z.email({ error: 'Neispravan format email adrese' }))
      .max(255, { error: 'Email je predugačak' })
      .transform((s) => s.trim().toLowerCase()), // ← Normalizacija

    phone: z
      .string()
      .max(30, { error: 'Broj telefona je predugačak' })
      .optional()
      .nullable()
      .transform((s) => s?.trim() || ''),

    startDate: z
      .string()
      .transform((str) => new Date(str))
      .refine(
        (date) => {
          // 🟢 Guests cannot select yesterday under any timezone shift
          return date >= getStartOfToday();
        },
        { message: 'Datum početka ne može biti u prošlosti.' },
      ),

    endDate: isoDatetime('endDate mora biti ISO 8601 string'),
  })
  .refine((data) => data.endDate > data.startDate, {
    error: 'Datum odlaska mora biti posle datuma dolaska',
    path: ['endDate'],
  })
  .refine(
    (data) => {
      const diffMs = data.endDate.getTime() - data.startDate.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return diffDays <= MAX_BOOKING_DAYS;
    },
    { error: `Zahtev ne može biti duži od ${MAX_BOOKING_DAYS} dana`, path: ['endDate'] },
  );

// Eksportovani tipovi za upotrebu u kontrolerima (TypeScript inference)
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
export type CreateGuestRequestInput = z.infer<typeof createGuestRequestSchema>;
