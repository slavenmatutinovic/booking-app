import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { prisma } from '../config/prisma';
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
        role: 'ADMIN' | 'VIEWER';
      };
    }
  }
}

// =============================================================================
// 🔒 MAKSIMALNO APSTRAHIRANI PRIVATNI HELPER (Nula Dupliranja)
// =============================================================================

/**
 * Jedinstveni izvor istine za proveru i keširanje sesije.
 * Koristi Pick<> za dinamičku ekstrakciju polja iz JwtPayload-a.
 */
async function resolveSessionFromToken(
  payload: JwtPayload,
): Promise<Pick<JwtPayload, 'tokenVersion' | 'role'> | null> {
  const cacheKey = `user:session:${payload.userId}`;

  // ⚡ RAM Keš Lookup — Pick<> osigurava da keš vraća isključivo tražena polja
  let session = appCache.get<Pick<JwtPayload, 'tokenVersion' | 'role'>>(cacheKey);

  if (!session) {
    // 💾 DB Fallback — Selektujemo samo polja koja su definisana u Pick-u
    const dbUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { tokenVersion: true, role: true },
    });

    if (!dbUser) {
      logger.warn({ userId: payload.userId }, '⚠️ Korisnik iz tokena više ne postoji u bazi!');
      return null;
    }

    // RAM Keš Set
    session = {
      tokenVersion: dbUser.tokenVersion,
      role: dbUser.role as 'ADMIN' | 'VIEWER',
    };

    appCache.set(cacheKey, session, 300);
  }

  return session;
}

// =============================================================================
// 🔒 requireAuth — Obavezna autentikacija
// =============================================================================

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  let token = req.cookies?.token;

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

    // Poziv maksimalno apstrahovanog helpera
    const cachedSession = await resolveSessionFromToken(payload);

    if (!cachedSession) {
      res.clearCookie('token', getCookieOptions());
      res.status(401).json({ error: 'Korisnik više ne postoji. Prijavite se ponovo.' });
      return;
    }

    // 🔒 KORAK 2: Provera validnosti verzije tokena (Instant opoziv)
    if (cachedSession.tokenVersion !== payload.tokenVersion) {
      logger.warn(
        { userId: payload.userId },
        '⚠️ Pokušaj pristupa sa opozvanim/starim JWT tokenom!',
      );

      appCache.del(`user:session:${payload.userId}`);
      res.clearCookie('token', getCookieOptions());

      res.status(401).json({ error: 'Sesija je istekla ili je poništena. Prijavite se ponovo.' });
      return;
    }

    req.user = {
      userId: payload.userId,
      role: cachedSession.role,
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

export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = req.cookies?.token;

  if (!token) {
    next();
    return;
  }

  try {
    const JWT_SECRET = env.JWT_SECRET;
    const payload = jwt.verify(token, JWT_SECRET) as unknown as JwtPayload;

    // Ponovna upotreba istog helpera
    const cachedSession = await resolveSessionFromToken(payload);

    // Reakcija na uspeh — ako verzija odgovara, kačimo usera, u suprotnom tiho nastavljamo kao gost
    if (cachedSession && cachedSession.tokenVersion === payload.tokenVersion) {
      req.user = {
        userId: payload.userId,
        role: cachedSession.role,
      };
    }
  } catch {
    // Nevažeći token — tiho ignoriši, nastavi kao gost bez bacanja greške
  }

  next();
};
