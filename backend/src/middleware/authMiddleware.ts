// =============================================================================
// 🔐 backend/src/middleware/authMiddleware.ts
// =============================================================================
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  AUTENTIKACIONI I AUTORIZACIONI MIDDLEWARE                              │
// │                                                                         │
// │  Tri middleware funkcije sa jasno razdvojenim odgovornostima:           │
// │                                                                         │
// │  requireAuth     → Zahtjeva validnu sesiju (401 ako nema)               │
// │  requireAdmin    → Zahtjeva ADMIN rolu (403 za sve ostale)              │
// │  optionalAuth    → Čita token ako postoji, ali ne blokira bez njega     │
// └─────────────────────────────────────────────────────────────────────────┘
//
// 📋 UPOTREBA U RUTAMA:
//
//   // Javna ruta — svi vide, ali prijavljivanje daje više detalja
//   router.get('/', optionalAuth, getBookings);
//
//   // Zaštićena ruta — samo prijavljeni
//   router.post('/', requireAuth, createBooking);
//
//   // Admin-only ruta
//   router.patch('/:id', requireAuth, requireAdmin, updateBooking);
//   router.delete('/:id', requireAuth, requireAdmin, deleteBooking);
//
// 🔒 BEZBEDNOSNI MODEL:
//
//   JWT payload sadrži: { userId, role, tokenVersion }
//   tokenVersion se provjerava pri /api/auth/me.
//   Stateless JWT rute (requireAuth) NE provjeravaju bazu — brže, ali
//   token ostaje validan do isteka čak i nakon logout-a.
//   getMe() provjerava tokenVersion u bazi — jedini siguran način za
//   sigurno invalidiranje sessije pri logout-u.
//
//   Kompromis: requireAuth je brži (bez DB round-trip), ali ne može
//   detektovati logout za do 2 sata (JWT expiry). Za admin operacije
//   koje zahtjevaju garantovanu invalidaciju, dodati DB provjeru.
//
// =============================================================================
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { prisma } from '../config/prisma';
import { UserRole } from '@shared/index';
import { appCache, getCookieOptions } from '../utils/cache';

interface JwtPayload {
  userId: string;
  role: 'ADMIN' | 'VIEWER';
  tokenVersion: number;
}

// Proširivanje Express Request tipa — dostupno svuda gdje se importuje
declare global {
  namespace Express {
    interface Request {
      /**
       * Populira se od strane requireAuth ili optionalAuth middleware-a.
       * undefined → middleware nije primijenjen ili token nije prisutan/validan.
       */
      user?: {
        userId: string;
        role: UserRole;
      };
    }
  }
}

// =============================================================================
// 🔒 requireAuth — Obavezna autentikacija
// =============================================================================

/**
 * 🔒 AUTENTIFIKACIJA KORISNIKA (Hibridni State-Tracked JWT Middleware)
 *
 * Verifikuje potpis klijentskog tokena, a zatim proverava 'tokenVersion'
 * radi instant opoziva sesije (npr. nakon odjave korisnika).
 *
 * ⚡ Optimizacija: Koristi lokalni in-memory keš (appCache) kako bi sprečio
 * ponovljene DB lookup round-trip upite na svakom zaštićenom API pozivu.
 */

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  let token = req.cookies?.token;

  // Podrška za Bearer Header (PowerShell/cURL/Postman kompatibilnost)
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    logger.warn('🔒 requireAuth — Pokušaj pristupa bez tokena');
    res.status(401).json({ error: 'Niste autorizovani. Token nedostaje.' });
    return;
  }

  try {
    const JWT_SECRET = env.JWT_SECRET;
    const payload = jwt.verify(token, JWT_SECRET) as unknown as JwtPayload;

    // Dinamički ključ za ovog specifičnog korisnika
    const cacheKey = `user:session:${payload.userId}`;

    // ⚡ KORAK 1: Pokušavamo da izvučemo podatke o sesiji iz brze memorije (RAM)
    let cachedSession = appCache.get<{ tokenVersion: number; role: 'ADMIN' | 'VIEWER' }>(cacheKey);

    if (!cachedSession) {
      // 💾 Cache MISS: Idemo u bazu samo ako podatak nije u memoriji
      const dbUser = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { tokenVersion: true, role: true },
      });

      if (!dbUser) {
        logger.warn({ userId: payload.userId }, '⚠️ Korisnik iz tokena više ne postoji u bazi!');
        res.clearCookie('token', getCookieOptions());
        res.status(401).json({ error: 'Korisnik više ne postoji. Prijavite se ponovo.' });
        return;
      }

      cachedSession = {
        tokenVersion: dbUser.tokenVersion,
        role: dbUser.role as 'ADMIN' | 'VIEWER',
      };

      // Keširamo podatke o korisniku na 5 minuta (300 sekundi) kako bismo rasteretili bazu
      appCache.set(cacheKey, cachedSession, 300);
    }

    // 🔒 KORAK 2: Provera validnosti verzije tokena (Logout / Poništavanje opoziv)
    if (cachedSession.tokenVersion !== payload.tokenVersion) {
      logger.warn(
        { userId: payload.userId },
        '⚠️ Pokušaj pristupa sa opozvanim/starim JWT tokenom!',
      );

      // Brišemo keš jer je token definitivno nevalidan
      appCache.del(cacheKey);
      res.clearCookie('token', getCookieOptions());

      res.status(401).json({ error: 'Sesija je istekla ili je poništena. Prijavite se ponovo.' });
      return;
    }

    // Ako je sve u redu, pakujemo podatke u req.user za sledeće kontrolere
    req.user = {
      userId: payload.userId,
      role: payload.role as 'ADMIN' | 'VIEWER',
    };

    next();
  } catch (error) {
    logger.warn({ err: error }, '⚠️ Pokušaj provere neispravnog tokena');
    res.status(401).json({ error: 'Neispravan ili istekao token.' });
  }
};
// =============================================================================
// 👑 requireAdmin — Obavezna ADMIN rola
// =============================================================================

/**
 * Middleware koji blokira sve korisnike koji nemaju ADMIN rolu.
 *
 * MORA se koristiti POSLIJE requireAuth (jer čita req.user koji requireAuth popunjava).
 * Greška u lancu: requireAdmin bez requireAuth bi prošao za sve jer req.user
 * bi bio undefined i provjera bi uvijek bila false → 403 za sve.
 *
 * Ispravno:   router.delete('/:id', requireAuth, requireAdmin, deleteBooking);
 * Pogrešno:   router.delete('/:id', requireAdmin, deleteBooking); ← uvijek 403!
 *
 * Koristiti za: Operacije upravljanja rezervacijama (create, update, delete)
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Nedovoljna prava pristupa' });
    return;
  }
  next();
};

// =============================================================================
// 👁️  optionalAuth — Opciona autentikacija (za javne rute)
// =============================================================================

/**
 * Middleware koji čita token ako postoji, ali NE blokira ako nema.
 *
 * Koristan za javne rute gdje prijavljivanje daje dodatne informacije:
 *   • GET /api/bookings — svi vide datume, prijavljeni vide detalje gostiju
 *   • GET /api/apartments — javno, ali prijavljivanje može dati admin detalje
 *
 * Primjer upotrebe u kontroleru:
 *   const isAdmin = req.user?.role === 'ADMIN';
 *   const guestName = isAdmin ? booking.guest : undefined; // Sakrij od javnosti
 *
 * Ne baca grešku na nevažeći token — samo ga ignoriše.
 * Razlog: Da ne blokiramo javne korisnike samo zbog starog/oštećenog kolačića.
 */
export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = req.cookies?.token;

  if (!token) {
    // Nema tokena — nastavi kao gost (req.user ostaje undefined)
    next();
    return;
  }

  try {
    const JWT_SECRET = env.JWT_SECRET;
    const payload = jwt.verify(token, JWT_SECRET) as unknown as JwtPayload;
    const cacheKey = `user:session:${payload.userId}`;
    // 🛡️ Look up the compiled token sequence variables inside central system cache arrays
    let cachedSession = appCache.get<{ tokenVersion: number; role: UserRole }>(cacheKey);

    if (!cachedSession) {
      const dbUser = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { tokenVersion: true, role: true },
      });

      if (dbUser) {
        cachedSession = {
          tokenVersion: dbUser.tokenVersion,
          role: dbUser.role as UserRole,
        };
        // Commit session state updates into server RAM memory for 5 minutes (300s)
        appCache.set(cacheKey, cachedSession, 300);
      }
    }

    // Explicit structural match mapping tracking rules evaluation
    if (cachedSession && cachedSession.tokenVersion === payload.tokenVersion) {
      req.user = {
        userId: payload.userId,
        role: cachedSession.role,
      };
    }
    // Ako tokenVersion ne odgovara, req.user ostaje undefined — ponašamo se kao gost
  } catch {
    // Nevažeći token — ignoriši, nastavi kao gost
    // Ne postavljamo req.user, ali ne vraćamo ni grešku
  }

  next();
};
