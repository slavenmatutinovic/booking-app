/**
 * server.ts — Ulazna tačka Express aplikacije.
 *
 * Redosled inicijalizacije je važan:
 * 1. dotenv mora biti PRVI import da bi sve naredne module videle .env varijable.
 * 2. Helmet (HTTP zaglavlja) pre svega ostalog — zaštita od clickjacking, XSS itd.
 * 3. CORS posle Helmet — needs to run after security headers are set.
 * 4. Rate limiter pre ruta — svaki zahtev prolazi proveru pre obrade.
 * 5. Rute u logičnom redosledu: auth → log → apartments → bookings.
 * 6. 404 handler mora biti POSLE svih ruta.
 * 7. Globalni error handler mora biti POSLEDNJI middleware (4 parametra).
 */
import 'dotenv/config'; // MORA BITI PRVI
import { logger } from './utils/logger';

import { env } from './config/env';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { login, logout, getMe } from './controllers/auth.controller';
import { requireAuth } from './middleware/authMiddleware';
import bookingsRouter from './routes/bookingsRoutes';
import healthRouter from './routes/healthRoutes';
import apartmentsRouter from './routes/apartmentsRoutes';
import logRouter from './routes/logRoutes';
import { initCleanupCron } from './cron/cleanupCron';
import { initBackupCron } from './cron/backupCreation';
import { Prisma } from '@prisma/client';
import compression from 'compression';
import { globalApiRateLimiter } from './middleware/rateLimiterMiddleware';
import { initializeBackupDirectory } from './cron/backupCreation';

const app = express();
const PORT = env.PORT;

// 🛡️  Poverenje u reverse proxy (Nginx, Render, Vercel) — bez ovoga req.ip vraća
// IP proxy-ja umesto stvarnog klijenta, što pokvari IP-based rate limiting.
if (env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// =============================================================================
// 🟢  AUTOMATED GLOBAL PRODUCTION HTTPS ENFORCEMENT REDIRECT
// =============================================================================
if (env.NODE_ENV === 'production') {
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Standard reverse proxy tracking header parameter evaluation check
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      next(); // Traffic layer is already secure, advance context execution forward safely
    } else {
      logger.info(
        { ip: req.ip, path: req.originalUrl },
        '🔒 [HTTPS GUARD] Presrećem nesiguran HTTP zahtev — preusmeravam na bezbedan SSL kanal...',
      );

      // Force a clean permanent browser-cached URL redirect targeting the safe SSL tunnel structure
      res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
    }
  });
}

// 🛡️ Globalni Middleware za bezbednost i parsiranje podataka
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"], // prilagoditi prema potrebi
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  }),
);
app.use(express.json());

app.use(
  compression({
    // Ne komprimuj odgovore manje od 1KB — overhead kompresije nije vredan za male payload-e
    threshold: 1024,
    // Nivo kompresije 6 = dobar balans između CPU i veličine (default je 6, max je 9)
    level: 6,
  }),
);

app.use(cookieParser());

// Pravimo listu dozvoljenih adresa
const allowedOrigins = [
  'http://localhost:5173', // Lokalni razvoj (Vite podrazumevano)
  'http://127.0.0.1:5173', // IP alternativa za lokalni razvoj
  env.FRONTEND_URL, // Zvanični produkcijski URL
].filter((url): url is string => Boolean(url)); // Čistimo potencijalne undefined/

// 🔀 CORS konfiguracija sa dinamičkim i eksplicitnim Origin-om (Neophodno za credentials)
app.use(
  cors({
    origin: (origin, callback) => {
      // Ako zahtev nema origin (npr. serverski cron poslovi, Postman ili interni testovi), dozvoljavamo pristup
      if (!origin) {
        if (env.NODE_ENV === 'production') {
          // 🛡️ Block anonymous non-browser requests from hitting production routes
          logger.warn('🚫 CORS Blocked: Request missing Origin header in production environment.');
          callback(new Error('CORS Policy: Origin header required.'));
          return;
        }
        // Allow for local backend API testing via Postman during development
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn({ origin }, '🚫 CORS blokirao pristup sa nepoznate adrese');
        callback(new Error('Pristup odbijen od strane CORS polise.'));
      }
    },
    credentials: true, // Dozvoljava slanje i čitanje HttpOnly kolačića (JWT tokena)
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  }),
);

// ── Rate Limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'development' ? 5000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Previše zahteva. Pokušajte ponovo za 15 minuta.' },
});
app.use(globalLimiter); // Pre svih ruta

// 🗺️ Osnovna test ruta za proveru ispravnosti servera
app.get('/api/test', (_req, res) => {
  logger.debug('🏓 GET /api/test');
  res.status(200).json({ status: 'UP' });
});

// 🟢 POBOLJŠANJE-12: Registracija novog health check endpointa
app.use('/api/health', healthRouter);

// ── Frontend log prijem ───────────────────────────────────────────────────────

// 🛡️ REŠENJE SEC-03: Rate Limiter specifično za primanje logova sa frontenda
const logLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minut
  max: env.NODE_ENV === 'development' ? 200 : 30, // Maksimalno 30 logova u minuti po korisniku na produkciji
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Previše poslatih logova. Zahtev blokiran zbog bezbednosti.' },
});
app.use('/api', logLimiter, logRouter);

// ── 2. IDENTITY-AWARE GLOBAL API LIMITER (BUG-09 Fix) ───────────────────────
// Postavljamo ga ODMAH ISPOD logera. On presreće sve preostale biznis rute na /api
// i pametno prati korisnike iza NAT-a po njihovom unikatnom 'userId'-ju!
app.use('/api', globalApiRateLimiter);

// ── Auth rute ─────────────────────────────────────────────────────────────────

// 🛑  Rate limiter za login je odvojen od globalnog jer dozvoljava svega 15 pokušaja
// u 15 minuta po IP adresi — zaštita od brute force napada na lozinke.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuta
  max: env.NODE_ENV === 'development' ? 200 : 30, // Viši limit za developera
  standardHeaders: true, // Šalje X-RateLimit-* zaglavlja sa info o preostalom broju pokušaja
  legacyHeaders: false,
  message: { error: 'Previše pokušaja logovanja. Pokušajte ponovo za 15 minuta.' },
});
// ISPRAVKA NOV-10: Redosled middleware — loginLimiter pre registracije auth ruta
const authRouter = express.Router();
authRouter.post('/login', loginLimiter, login);
authRouter.post('/logout', requireAuth, logout);
// ISPRAVKA: getMe handler prebačen ovde iz inline koda u server.ts
authRouter.get('/me', requireAuth, getMe);
app.use('/api/auth', authRouter);

// ── Apartments rute (čita iz baze, ne hardkodovano!) ─────────────────────────
app.use('/api/apartments', apartmentsRouter);

// ── Bookings rute (potpuna CRUD implementacija) ───────────────────────────────
app.use('/api/bookings', bookingsRouter);

// ── Admin-only primer rute ────────────────────────────────────────────────────
// app.delete('/api/bookings/:id', requireAuth, requireAdmin, deleteBookingHandler);

// ⏰ Pokretanje pozadinskih cron zadataka
// Pokrećemo inicijalizacioni lanac

// ─── POKRETANJE SERVERA (STARTUP LIFE-CYCLE) ──────────────────────────────────
const startServer = async () => {
  try {
    // 🛡️ KORAK 1: Inicijalizujemo bezbedan bekap folder van web root-a pre podizanja servera
    await initializeBackupDirectory();
    logger.info('📂 Bezbedan bekap direktorijum je uspešno verifikovan i spreman.');

    // 🚀 KORAK 2: Pokrećemo Express server da sluša dolazni saobraćaj
    app.listen(env.PORT, () => {
      logger.info(
        `🚀 Server je uspešno podignut i sluša na portu ${env.PORT} unutar [${env.NODE_ENV}] okruženja.`,
      );
      logger.info(`🌐 Frontend URL: ${env.FRONTEND_URL}`);
    });
  } catch (error) {
    const errObj = error as Record<string, unknown>;
    logger.error(
      { err: errObj?.message || String(error) },
      '❌ Kritična greška: Neuspešno podizanje servera tokom inicijalizacije:',
    );
    process.exit(1); // "Fail-fast" princip: gasimo proces ako osnovna infrastruktura fali
  }
};

initCleanupCron();
initBackupCron();
startServer();

// ── Handle 404 — Nepostojeće Rute ─────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Traženi endpoint ne postoji.' });
});

// ── Globalni Error Handler (MORA BITI NA SAMOM KRAJU LANCA) ────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, '🚨 Neuhvaćena globalna greška na Express aplikaciji');

  // Prisma greška — narušen unique constraint u bazi
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'Zapis sa tim vrednostima već postoji.' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Traženi zapis ne postoji.' });
      return;
    }
  }

  // Prisma timeout greška
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    res.status(503).json({ error: 'Baza podataka privremeno nedostupna.' });
    return;
  }

  // Bezbedno kastovanje i provera tipa za nepoznate greške
  const errorMessage = err instanceof Error ? err.message : 'Unutrašnja greška na serveru';
  res.status(500).json({
    error:
      env.NODE_ENV === 'development' ? errorMessage : 'Došlo je do neočekivane greške na serveru.',
  });
});
