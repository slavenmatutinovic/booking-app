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

export const createApartmentRateSchema = z
  .object({
    body: z.object({
      apartmentId: z.string().min(1, 'ID apartmana je obavezan.'),
      startDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Neispravan format početnog datuma (YYYY-MM-DD).'),
      endDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Neispravan format krajnjeg datuma (YYYY-MM-DD).'),
      price: z.number().positive('Cena mora biti veća od nule.'),
      capacity: z
        .number()
        .int()
        .min(1, 'Kapacitet mora biti najmanje 1 osoba.')
        .max(20, 'Kapacitet ne može biti veći od 20 osoba.'),
    }),
  })
  .refine(
    (schemaData) => {
      // 🛡️ Zod v4 bezbedna provera: Prvo proveravamo da li datumi uopšte prate regex šemu
      // pre nego što pokušamo da izvučemo milisekunde. Ovo sprečava "NaN" padove.
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(schemaData.body.startDate) || !dateRegex.test(schemaData.body.endDate)) {
        return true; // Puštamo da primarni regex validator iznad izbaci tačnu poruku o formatu
      }

      const start = new Date(schemaData.body.startDate).getTime();
      const end = new Date(schemaData.body.endDate).getTime();

      // Kraj sezone mora biti striktno nakon početka sezone (Vremenski razmak veći od 0)
      return end > start;
    },
    {
      message:
        'Završni datum sezone mora biti striktno nakon početnog datuma (sezona ne može trajati 0 dana).',
      // 🎯 ZOD v4 sintaksa za ugnježđene putanje: mapiramo grešku tačno na error.body.endDate
      path: ['body', 'endDate'],
    },
  );

export const updateApartmentRateSchema = z.object({
  params: z.object({
    id: z.string({ message: 'ID cene je obavezan.' }),
  }),
  body: z.object({
    price: z
      .number({ message: 'Cena je obavezna i mora biti broj.' })
      .positive('Cena mora biti veća od 0.'),
  }),
});

export const updateApartmentSchema = createApartmentSchema.partial();

export type CreateApartmentInput = z.infer<typeof createApartmentSchema>;
export type UpdateApartmentInput = z.infer<typeof updateApartmentSchema>;

// Izvozimo tip za frontend ako zatreba
export type UpdateApartmentRateInput = z.infer<typeof updateApartmentRateSchema>;
export type CreateApartmentRateInput = z.infer<typeof createApartmentRateSchema>;
