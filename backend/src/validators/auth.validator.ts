// backend/src/validators/auth.validator.ts
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email({ error: 'Neispravan format emaila' }).pipe(z.string().max(255)),
  password: z.string().min(1, { error: 'Lozinka je obavezna' }).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

// 🛡️ Stroga Zod šema za validaciju logova sa frontenda (Sprečava unošenje predugačkih skripti)
export const frontendLogSchema = z.object({
  level: z.enum(['info', 'warn', 'error']),
  message: z.string().min(1).max(255, { message: 'Poruka loga je predugačka.' }),
  errorDetails: z.unknown().optional(),
  url: z.string().url().max(500).optional(), // Automatski validira da li je u pitanju ispravan URL
});
