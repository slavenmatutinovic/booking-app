// backend/src/validators/apartment.validator.ts
import { z } from 'zod';

export const createApartmentSchema = z.object({
  name: z
    .string({ error: 'Naziv apartmana je obavezan i mora biti tekst' })
    .min(2, { error: 'Naziv apartmana mora imati najmanje 2 karaktera' })
    .max(100, { error: 'Naziv apartmana je predugačak' }),
  description: z
    .string({ error: 'Opis mora biti tekst' })
    .max(1000, { error: 'Opis je predugačak' })
    .optional()
    .nullable()
    .default(null),
});

export const updateApartmentSchema = createApartmentSchema.partial();

export type CreateApartmentInput = z.infer<typeof createApartmentSchema>;
export type UpdateApartmentInput = z.infer<typeof updateApartmentSchema>;
