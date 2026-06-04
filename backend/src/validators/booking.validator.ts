// backend/src/validators/booking.validator.ts (DEO 1)
import { z } from 'zod';
import { MAX_BOOKING_DAYS } from '../../../shared/index';

// Regex koji prihvata validan ISO 8601 UTC datetime string
const isoDatetimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isoDatetime(errorMsg: string) {
  return z
    .string({ message: errorMsg })
    .regex(isoDatetimeRegex, { message: errorMsg })
    .transform((s: string) => new Date(s));
}

const getStartOfToday = (): Date => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

export const createBookingSchema = z
  .object({
    // ✅ ISPRAVNO ZA v4: Koristimo top-level z.uuid() za ID apartmana
    apartmentId: z.uuid({ message: 'ID apartmana mora biti u validnom UUID formatu.' }),

    guest: z
      .string({ message: 'Ime gosta mora biti tekst.' })
      .min(2, { message: 'Ime gosta mora imati najmanje 2 karaktera.' })
      .max(100, { message: 'Ime gosta je predugačko.' })
      .transform((s: string) => s.trim()),

    // ✅ ISPRAVNO ZA v4: Uklonjen nepostojeći .check() i spojen lanac u z.email()
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
        const absolutePastThreshold = getStartOfToday();
        absolutePastThreshold.setHours(absolutePastThreshold.getHours() - 12);
        return date >= absolutePastThreshold;
      },
      { message: 'Početni datum ne može biti u prošlosti.' },
    ),

    endDate: isoDatetime('endDate mora biti validan ISO 8601 string.'),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: 'Datum odlaska mora biti posle datuma dolaska.',
    path: ['endDate'],
  })
  .refine(
    (data) => {
      const diffTime = Math.abs(data.endDate.getTime() - data.startDate.getTime());
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
    apartmentId: z.uuid({ message: 'Nevažeći ID apartmana.' }).optional(),

    guest: z
      .string({ message: 'Ime gosta mora biti tekst.' })
      .min(2, { message: 'Ime gosta mora imati najmanje 2 karaktera.' })
      .max(100, { message: 'Ime gosta je predugačko.' })
      .transform((s: string) => s.trim())
      .optional(),

    // ✅ ISPRAVNO ZA v4: Zamenjen stari .check() sa čistim z.email()
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
    apartmentId: z.uuid({ message: 'ID apartmana je obavezan i mora biti validan.' }),

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

    startDate: z
      .string({ message: 'Datum početka je obavezan.' })
      .transform((str: string) => new Date(str))
      .refine((date: Date) => date >= getStartOfToday(), {
        message: 'Datum početka ne može biti in the past.',
      }),

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
