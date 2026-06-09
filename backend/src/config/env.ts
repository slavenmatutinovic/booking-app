/**
 * env.ts — Validacija environment varijabli pri pokretanju aplikacije.
 *
 * Parsiranje se dešava pri importu modula. Ako obavezna varijabla nedostaje,
 * aplikacija odmah pada sa jasnom porukom greške — "fail fast" princip.
 * Ovo je bolje od tihe greške koja bi se pojavila mnogo kasnije u runtime-u.
 *
 * z.coerce.number() za PORT konvertuje string "4000" (sve env varijable su
 * strings) u broj — bez toga bi Express slušao na `NaN` portu.
 *
 * DATABASE_URL koristi .min(1) umesto .url() jer Zod-ov .url() validator
 * odbacuje validne PostgreSQL URL šeme poput postgresql:// ili postgres://.
 *
 * SMTP varijable su opcionalne — aplikacija radi bez email konfiguracije,
 * ali će logujući upozorenje pri pokretanju (emailovi se neće slati).
 */

import { z } from 'zod';
import 'dotenv/config'; // Osigurava da su .env varijable učitane pre provere

const envSchema = z.object({
  // ─── Baza podataka ───────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, 'DATABASE_URL je obavezna varijabla'),
  // Koristi se .min(1) jer .url() zna da odbaci postgresql:// protokole

  // ─── JWT autentikacija ───────────────────────────────────────────────────
  // min(32) zahteva bar 256-bit ključ — ispod toga JWT nije bezbedan
  JWT_SECRET: z.string().min(32, 'JWT_SECRET mora imati najmanje 32 karaktera za bezbednost'),

  // ─── Server ──────────────────────────────────────────────────────────────
  PORT: z.coerce.number().default(4000),
  // z.coerce.number() uspešno pretvara string "4000" iz .env-a u pravi broj

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  BACKEND_URL: z
    .string()
    .url({ message: 'BACKEND_URL mora biti validan URL format (npr. https://mojsajt.com)' })
    .default('http://localhost:4000'), // Synchronized with your global port configuration fallback

  // ✅ ISPRAVLJENO: Izmenjeno sa z.url() na z.string().url() jer z.url() ne postoji u Zod v4!
  FRONTEND_URL: z
    .string()
    .url({ message: 'FRONTEND_URL mora biti validan URL format.' })
    .default('http://localhost:5173'),

  // ─── Seed lozinka (za db:seed komandu) ───────────────────────────────────
  ADMIN_SEED_PASSWORD: z.string().min(4).optional(),

  // ─── Email (SMTP) ─────────────────────────────────────────────────────────
  //
  // Sve SMTP varijable su opcionalne. Ako SMTP_HOST, SMTP_USER ili SMTP_PASS
  // nedostaju, emailService.ts će logujući upozorenje i preskočiti slanje.
  //
  // Gmail primer:
  //   SMTP_HOST=smtp.gmail.com
  //   SMTP_PORT=587
  //   SMTP_SECURE=false        # true za port 465 (SSL), false za 587 (STARTTLS)
  //   SMTP_USER=vaš.email@gmail.com
  //   SMTP_PASS=abcd efgh ijkl mnop   # Gmail App Password (ne prava lozinka!)
  //   SMTP_FROM="Booking System <vaš.email@gmail.com>"
  //
  // Mailtrap (development sandbox):
  //   SMTP_HOST=sandbox.smtp.mailtrap.io
  //   SMTP_PORT=2525
  //   SMTP_USER=<iz Mailtrap dashboard-a>
  //   SMTP_PASS=<iz Mailtrap dashboard-a>
  //
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),

  // SMTP_SECURE: "true" za SSL port 465, "false" za STARTTLS port 587
  // z.string().transform() konvertuje env string u boolean
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // Display name i email adresa pošiljaoca
  SMTP_FROM: z.string().default('Booking System <noreply@booking.local>'),

  // Admin email prima kopiju svake rezervacije i otkazivanja
  // Opcionalan — ako nije postavljen, samo gost dobija email
  ADMIN_EMAIL: z
    .string()
    .refine((val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), {
      message: 'ADMIN_EMAIL mora biti validna email adresa',
    })
    .optional(),
  DISABLE_RATE_LIMITER: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
});

// Parsiramo process.env i izvozimo bezbedan objekat
export const env = envSchema.parse(process.env);

// ✅ ISPRAVLJENO: Koristi se z.output kako bi TypeScript prepoznao transformisani oblik (npr. SMTP_SECURE kao boolean)
export type EnvType = z.output<typeof envSchema>;
