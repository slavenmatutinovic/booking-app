// backend/src/validators/booking.validator.ts (DEO 1)
import { z } from 'zod';
import { MAX_BOOKING_DAYS } from '../../../shared/index';
import { getUTCStartOfToday } from '../utils/dateUtils';

// Regex koji prihvata validan ISO 8601 UTC datetime string
const isoDatetimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isoDatetime(errorMsg: string) {
  return z
    .string({ message: errorMsg })
    .regex(isoDatetimeRegex, { message: errorMsg })
    .transform((s: string) => new Date(s));
}

export const createBookingSchema = z
  .object({
    apartmentId: z
      .string({ message: 'ID apartmana je obavezan.' })
      .min(1, { message: 'ID apartmana ne može biti prazan.' }),

    guest: z
      .string({ message: 'Ime gosta mora biti tekst.' })
      .min(2, { message: 'Ime gosta mora imati najmanje 2 karaktera.' })
      .max(100, { message: 'Ime gosta je predugačko.' })
      .transform((s: string) => s.trim()),

    email: z
      .email({ message: 'Neispravan format email adrese.' })
      .max(255, { message: 'Email je predugačak.' })
      .transform((s: string) => s.trim().toLowerCase()),

    phone: z
      .string({ message: 'Broj telefona mora biti tekst.' })
      .max(30, { message: 'Broj telefona je predugačak.' })
      .optional()
      .nullable()
      .default(''),

    startDate: isoDatetime(
      'startDate mora biti validan ISO 8601 string (npr. 2026-06-01T00:00:00.000Z)',
    ).refine(
      (date: Date) => {
        // Safe protection if field validation processing encounters an Invalid Date loop
        if (isNaN(date.getTime())) return false;
        const absolutePastThreshold = getUTCStartOfToday();
        absolutePastThreshold.setUTCHours(absolutePastThreshold.getUTCHours() - 12);
        return date >= absolutePastThreshold;
      },
      { message: 'Početni datum ne može biti u prošlosti.' },
    ),

    endDate: isoDatetime('endDate mora biti validan ISO 8601 string.'),
  })
  .refine(
    (data) => {
      const start = data.startDate;
      const end = data.endDate;

      if (
        !(start instanceof Date) ||
        !(end instanceof Date) ||
        isNaN(start.getTime()) ||
        isNaN(end.getTime())
      ) {
        return false; // Kratak spoj: Puštamo primarne regex validatore iznad da bace poruku o formatu
      }

      return end.getTime() > start.getTime();
    },
    {
      message: 'Datum odlaska mora biti posle datuma dolaska.',
      path: ['endDate'],
    },
  )
  .refine(
    (data) => {
      const start = data.startDate;
      const end = data.endDate;

      if (
        !(start instanceof Date) ||
        !(end instanceof Date) ||
        isNaN(start.getTime()) ||
        isNaN(end.getTime())
      ) {
        return false;
      }

      const diffTime = Math.abs(end.getTime() - start.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays <= MAX_BOOKING_DAYS;
    },
    {
      message: `Rezervacija ne može trajati duže od ${MAX_BOOKING_DAYS} dana.`,
      path: ['endDate'],
    },
  );

// backend/src/validators/booking.validator.ts (DEO 2)

export const updateBookingSchema = z
  .object({
    apartmentId: z
      .string({ message: 'ID apartmana je obavezan.' })
      .min(1, { message: 'ID apartmana ne može biti prazan.' })
      .optional(),

    guest: z
      .string({ message: 'Ime gosta mora biti tekst.' })
      .min(2, { message: 'Ime gosta mora imati najmanje 2 karaktera.' })
      .max(100, { message: 'Ime gosta je predugačko.' })
      .transform((s: string) => s.trim())
      .optional(),

    email: z
      .email({ message: 'Neispravan format email adrese.' })
      .max(255, { message: 'Email je predugačak.' })
      .transform((s: string) => s.trim().toLowerCase())
      .optional(),

    phone: z
      .string({ message: 'Broj telefona mora biti tekst.' })
      .max(30, { message: 'Broj telefona je predugačak.' })
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
        message: 'Status može biti samo CONFIRMED ili CANCELLED.',
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
    { message: 'Datum odlaska mora biti posle datuma dolaska.', path: ['endDate'] },
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
    { message: `Rezervacija ne može trajati duže od ${MAX_BOOKING_DAYS} dana.`, path: ['endDate'] },
  );

export const createGuestRequestSchema = z
  .object({
    apartmentId: z
      .string({ message: 'ID apartmana je obavezan.' })
      .min(1, { message: 'ID apartmana ne može biti prazan.' }),

    guest: z
      .string({ message: 'Ime je obavezno.' })
      .min(2, { message: 'Ime mora imati najmanje 2 karaktera.' })
      .max(100, { message: 'Ime je predugačko (max 100 karaktera).' })
      .transform((s: string) => s.trim()),

    email: z
      .email({ message: 'Neispravan format email adrese.' })
      .max(255, { message: 'Email je predugačak.' })
      .transform((s: string) => s.trim().toLowerCase()),

    phone: z
      .string()
      .max(30, { message: 'Broj telefona je predugačak.' })
      .optional()
      .nullable()
      .transform((s: string | null | undefined) => s?.trim() || ''),

    startDate: isoDatetime(
      'startDate mora biti ISO 8601 string (npr. 2026-06-01T00:00:00.000Z).',
    ).refine(
      (date: Date) => {
        const threshold = getUTCStartOfToday();
        // Dozvoljavamo 12h tolerancije za globalne vremenske razlike
        threshold.setUTCHours(threshold.getUTCHours() - 12);
        return date >= threshold;
      },
      { message: 'Datum početka ne može biti u prošlosti.' },
    ),

    endDate: isoDatetime('endDate mora biti ISO 8601 string.'),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: 'Datum odlaska mora biti posle datuma dolaska.',
    path: ['endDate'],
  })
  .refine(
    (data) => {
      const diffMs = data.endDate.getTime() - data.startDate.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return diffDays <= MAX_BOOKING_DAYS;
    },
    { message: `Zahtev ne može biti duži od ${MAX_BOOKING_DAYS} dana.`, path: ['endDate'] },
  );

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
export type CreateGuestRequestInput = z.infer<typeof createGuestRequestSchema>;
