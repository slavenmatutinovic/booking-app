// backend/src/validators/booking.validator.ts
import { z } from 'zod';
import { MAX_BOOKING_DAYS } from '../../../shared/index';

export const createBookingSchema = z
  .object({
    apartmentId: z
      .string({ error: 'ID apartmana je obavezan i mora biti tekst' })
      .min(1, { error: 'ID apartmana je obavezan' }),

    guest: z
      .string({ error: 'Ime gosta je obavezno i mora biti tekst' })
      .min(2, { error: 'Ime gosta mora imati najmanje 2 karaktera' })
      .max(100, { error: 'Ime gosta je predugačko' }),

    email: z
      .string({ error: 'Email adresa je obavezna' })
      .check(z.email({ error: 'Neispravan format email adrese' }))
      .max(255, { error: 'Email je predugačak' }),

    phone: z
      .string({ error: 'Broj telefona mora biti tekst' })
      .max(30, { error: 'Broj telefona je predugačak' })
      .optional()
      .nullable()
      .default(''),

    startDate: z.iso
      .datetime({
        error: 'startDate mora biti validan ISO 8601 string (npr. 2026-06-01T00:00:00.000Z)',
      })
      .transform((s) => new Date(s))
      .refine(
        (date) => {
          const absolutePastThreshold = new Date();
          absolutePastThreshold.setHours(absolutePastThreshold.getHours() - 12);
          return date >= absolutePastThreshold;
        },
        { error: 'Početni datum ne može biti u prošlosti' },
      ),

    endDate: z.iso
      .datetime({ error: 'endDate mora biti validan ISO 8601 string' })
      .transform((s) => new Date(s)),
  })
  .refine((data) => data.endDate > data.startDate, {
    error: 'Datum odlaska mora biti posle datuma dolaska',
    path: ['endDate'],
  })
  .refine(
    (data) => {
      const diffTime = Math.abs(data.endDate.getTime() - data.startDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays <= MAX_BOOKING_DAYS;
    },
    {
      error: `Rezervacija ne može trajati duže od ${MAX_BOOKING_DAYS} dana`,
      path: ['endDate'],
    },
  );

export const updateBookingSchema = z
  .object({
    guest: z
      .string({ error: 'Ime gosta mora biti tekst' })
      .min(2, { error: 'Ime gosta mora imati najmanje 2 karaktera' })
      .max(100, { error: 'Ime gosta je predugačko' })
      .optional(),

    email: z
      .string({ error: 'Email mora biti tekst' })
      .check(z.email({ error: 'Neispravan format email adrese' }))
      .max(255, { error: 'Email je predugačak' })
      .optional(),

    phone: z
      .string({ error: 'Broj telefona mora biti tekst' })
      .max(30, { error: 'Broj telefona je predugačak' })
      .nullable()
      .optional(),

    startDate: z.iso
      .datetime({
        error: 'startDate mora biti validan ISO 8601 string (npr. 2026-06-01T00:00:00.000Z)',
      })
      .transform((s) => new Date(s))
      .optional(),

    endDate: z.iso
      .datetime({
        error: 'endDate mora biti validan ISO 8601 string (npr. 2026-06-01T00:00:00.000Z)',
      })
      .transform((s) => new Date(s))
      .optional(),

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

// Eksportovani tipovi za upotrebu u kontrolerima (TypeScript inference)
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
