import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';
import { Prisma } from '@prisma/client';
import { appCache, CACHE_KEYS } from '../utils/cache';

// ─── GET /api/bookings ─────────────────────────────────────────────────────────
export const getBookings = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { startMonth, endMonth, limit = '200', cursor } = req.query;
  logger.debug({ query: req.query, userId: req.user?.userId }, '📋 GET /api/bookings');

  const month = req.query.month as string | undefined;
  const apartmentId = req.query.apartmentId as string | undefined;

  const where: Prisma.BookingWhereInput = { status: 'CONFIRMED' };

  if (apartmentId) {
    where.apartmentId = String(apartmentId);
  }

  // 🔒 HOTELSKE SMENE OPSEGA: Ako klijent šalje opseg meseci (npr. maj i jun)
  if (startMonth && endMonth) {
    const [sYear, sMon] = String(startMonth).split('-').map(Number);
    const [eYear, eMon] = String(endMonth).split('-').map(Number);

    if (sYear && sMon && eYear && eMon) {
      const startRange = new Date(sYear, sMon - 1, 1, 0, 0, 0);
      const endRange = new Date(eYear, eMon, 0, 23, 59, 59);

      // Koristimo stroge hotelske operatore (lt i gt) da se datumi smena ne sudaraju!
      where.startDate = { lt: endRange };
      where.endDate = { gt: startRange };
    }
  }
  // Fallback na stari jednokanalni mesec ako startMonth/endMonth ne stignu
  else if (month) {
    const [year, mon] = String(month).split('-').map(Number);
    if (!year || !mon || mon < 1 || mon > 12) {
      res.status(400).json({ error: 'Neispravan format meseca. Koristite YYYY-MM.' });
      return;
    }
    const startOfMonth = new Date(year, mon - 1, 1, 0, 0, 0);
    const endOfMonth = new Date(year, mon, 0, 23, 59, 59);

    where.startDate = { lt: endOfMonth };
    where.endDate = { gt: startOfMonth };
  }

  try {
    const parsedLimit = Math.min(Number(limit), 500);

    // Prisma query opcije
    const queryOptions: Prisma.BookingFindManyArgs = {
      where,
      include: { apartment: { select: { id: true, name: true } } },
      // Uzimamo 1 stavku više da proverimo da li ima još stranica za sledeći cursor
      take: parsedLimit + 1,
      orderBy: { id: 'asc' }, // Za pouzdan cursor, orderBy mora biti na unikatnom polju poput 'id'
    };

    // Ako je prosleđen cursor, dodajemo ga u Prisma opcije
    if (cursor) {
      queryOptions.cursor = { id: String(cursor) };
      queryOptions.skip = 1; // Preskačemo sam cursor element da ga ne učitamo ponovo
    }

    const shouldCache = !cursor;
    // Kreiramo dinamički ključ na osnovu parametara pretrage (npr. "bookings:2026-07")
    const cacheKey = CACHE_KEYS.BOOKINGS(month, apartmentId);

    if (shouldCache) {
      const cachedBookings = appCache.get(cacheKey);
      if (cachedBookings) {
        res.json(cachedBookings);
        return;
      }
    }

    const bookings = await prisma.booking.findMany(queryOptions);

    // Provera da li ima sledeće stranice
    let nextCursor: string | undefined = undefined;
    if (bookings.length > parsedLimit) {
      const nextItem = bookings.pop(); // Sklanjamo taj +1 element
      nextCursor = nextItem?.id; // Njegov ID postaje sledeći cursor
    }

    logger.info({ count: bookings.length, month, apartmentId }, '✅ getBookings — učitano');

    /**
     * Filtriranje osetljivih podataka na osnovu role pozivajućeg korisnika.
     *
     * Javni korisnici (gosti bez naloga) ne smeju videti:
     *   - Ime gosta (guest) — GDPR: lično ime
     *   - Email adresu (email) — GDPR: lični kontakt
     *   - Broj telefona (phone) — GDPR: lični kontakt
     *
     * Prijavljeni korisnici (VIEWER i ADMIN) vide sve podatke.
     *
     * Napomena: Ovo je dodatni sloj zaštite na backendu. Frontend
     * implementira isti filter radi UX-a (sakrij polja u UI-u),
     * ali backend filter je jedini koji je bezbednosno relevantan.
     */
    const isAuthenticated = !!req.user;

    const filteredBookings = isAuthenticated
      ? bookings // Prijavljeni vide sve
      : bookings.map(({ guest: _g, email: _e, phone: _p, ...publicFields }) => publicFields);
    // ↑ Javni korisnici dobijaju samo: id, apartmentId, startDate, endDate, status, apartment

    const responsePayload = { bookings: filteredBookings, nextCursor };

    // Keširamo ovaj specifičan mesec/apartman
    if (shouldCache) {
      appCache.set(cacheKey, responsePayload, 1800);
    }

    res.json(responsePayload);
  } catch (error) {
    logger.error({ err: error }, '❌ getBookings — greška u bazi');
    next(error); // ← Prosleđuje grešku globalnom handleru
  }
};
