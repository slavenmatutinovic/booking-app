import { z } from 'zod';

export const createApartmentRateSchema = z
  .object({
    apartmentId: z.string().cuid('Nevalidan ID apartmana'),

    // ✅ Parse network ISO strings directly into stable Date instances
    startDate: z
      .string()
      .datetime({ message: 'Početni datum mora biti validan ISO 8601 string' })
      .transform((val) => new Date(val)),

    endDate: z
      .string()
      .datetime({ message: 'Krajnji datum mora biti validan ISO 8601 string' })
      .transform((val) => new Date(val)),

    price: z
      .number()
      .positive('Cena po noćenju mora biti veća od 0')
      .max(10000, 'Cena prelazi maksimalni dozvoljeni limit'),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'Krajnji datum sezone ne može biti pre početnog datuma',
    path: ['endDate'],
  });
