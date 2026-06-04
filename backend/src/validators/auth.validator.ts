// backend/src/validators/auth.validator.ts
import { z } from 'zod';

export const loginSchema = z.object({
  // ✅ ISPRAVNO ZA ZOD v4: Koristi se top-level z.email() i ključ 'message'
  email: z
    .email({ message: 'Neispravan format emaila' })
    .max(255, { message: 'Email ne može biti duži od 255 karaktera.' }),

  password: z
    .string()
    .min(1, { message: 'Lozinka je obavezna' })
    .max(128, { message: 'Lozinka ne može biti duža od 128 karaktera.' }),
});

export type LoginInput = z.infer<typeof loginSchema>;

// 🛡️ Stroga Zod šema za validaciju logova sa frontenda
export const frontendLogSchema = z.object({
  level: z.enum(['info', 'warn', 'error'], {
    message: 'Nivo loga mora biti info, warn ili error.',
  }),

  message: z
    .string()
    .min(1, { message: 'Poruka loga ne može biti prazna.' })
    .max(255, { message: 'Poruka loga je predugačka.' }),

  errorDetails: z.unknown().optional(),

  // ✅ ISPRAVNO ZA ZOD v4: Koristi se top-level z.url() umesto z.string().url()
  url: z
    .url({ message: 'URL mora biti u ispravnom formatu.' })
    .max(500, { message: 'URL ne može biti duži od 500 karaktera.' })
    .optional(),
});

export type FrontendLogInput = z.infer<typeof frontendLogSchema>;
