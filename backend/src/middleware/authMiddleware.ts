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

// Pomocna funkcija za konfiguraciju bezbednih opcija kolacica
const getCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction, // true samo u produkciji (zahteva HTTPS)
    sameSite: isProduction ? ('strict' as const) : ('lax' as const),
  };
};

// Definišemo precizan interfejs za strukturu tvog JWT payload-a
interface JwtPayload {
  userId: string;
  role: 'ADMIN' | 'VIEWER';
  tokenVersion: number; // Dodajemo tvoj tokenVersion u tipove
}

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
    const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

    const payload = jwt.verify(token, JWT_SECRET) as unknown as JwtPayload;

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

      // VAŽNO: Brišemo stari nevažeći kolačić iz browsera da ga oslobodimo petlje
      res.clearCookie('token', getCookieOptions());

      res.status(401).json({ error: 'Sesija je istekla ili je poništena. Prijavite se ponovo.' });
      return;
    }

    // Ako je sve u redu, pakujemo podatke u req.user za sledeće kontrolere
    req.user = {
      userId: payload.userId,
      role: payload.role as 'ADMIN' | 'VIEWER',
    };

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
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    // Provera tokenVersion — isti mehanizam kao u requireAuth
    const dbUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { tokenVersion: true },
    });

    if (dbUser && dbUser.tokenVersion === payload.tokenVersion) {
      req.user = payload;
    }
    // Ako tokenVersion ne odgovara, req.user ostaje undefined — ponašamo se kao gost
  } catch {
    // Nevažeći token — ignoriši, nastavi kao gost
    // Ne postavljamo req.user, ali ne vraćamo ni grešku
  }

  next();
};
