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
      user?: JwtPayload;
    }
  }
}

// =============================================================================
// 🔒 requireAuth — Obavezna autentikacija
// =============================================================================

/**
 * Middleware koji blokira zahtjeve bez validnog JWT tokena.
 *
 * Provjerava HttpOnly kolačić 'token', verifikuje potpis i dekodira payload.
 * Ne pristupa bazi podataka — čisto stateless JWT verifikacija.
 *
 * Kada uspije: popunjava req.user i poziva next()
 * Kada ne uspije: vraća 401 i NE poziva next()
 *
 * Koristiti za: POST, PATCH, DELETE rute koje zahtjevaju prijavu
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
    res.status(401).json({ error: 'Nije prijavljen. Pristup odbijen.' });
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

    // 🔒 REŠENJE ZA BUG-07: Provera uništenih sesija (Logout opoziv)
    // Brzi upit u bazu proverava da li je korisnik u međuvremenu kliknuo na Logout
    const dbUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { tokenVersion: true },
    });

    if (!dbUser || dbUser.tokenVersion !== payload.tokenVersion) {
      logger.warn(
        { userId: payload.userId },
        '⚠️ Pokušaj pristupa sa opozvanim/starim JWT tokenom!',
      );
      res.status(401).json({ error: 'Sesija je istekla ili je poništena. Prijavite se ponovo.' });
      return;
    }

    // Ako je sve u redu, prosleđujemo podatke o korisniku u zahtev
    req.user = payload;
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
export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const token = req.cookies?.token;

  if (!token) {
    // Nema tokena — nastavi kao gost (req.user ostaje undefined)
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    req.user = payload;
  } catch {
    // Nevažeći token — ignoriši, nastavi kao gost
    // Ne postavljamo req.user, ali ne vraćamo ni grešku
  }

  next();
};
