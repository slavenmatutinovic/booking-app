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

  const where: Prisma.BookingWhereInput = {
    status: 'CONFIRMED',
    apartment: {
      isDeleted: false, // 🛡️ Critical: Cascades soft-delete enforcement to nested relational hooks
    },
  };

  if (apartmentId) {
    where.apartmentId = String(apartmentId);
  }

  // 🔒 HOTELSKE SMENE OPSEGA: Ako klijent šalje opseg meseci (npr. maj i jun)
  if (startMonth && endMonth) {
    const sYear = parseInt(req.query.startYear as string);
    const sMon = parseInt(req.query.startMonth as string);
    const eYear = parseInt(req.query.endYear as string);
    const eMon = parseInt(req.query.endMonth as string);

    let startRange: Date;
    let endRange: Date;

    if (sYear && sMon && eYear && eMon) {
      startRange = new Date(Date.UTC(sYear, sMon - 1, 1, 0, 0, 0));
      endRange = new Date(Date.UTC(eYear, eMon, 0, 23, 59, 59));
    } else {
      // Fallback za single month parameter flow if range boundaries are missing
      const year = parseInt(req.query.year as string) || new Date().getUTCFullYear();
      const mon = parseInt(req.query.month as string) || new Date().getUTCMonth() + 1;

      // ✅ Fallback za single month:
      startRange = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0));
      endRange = new Date(Date.UTC(year, mon, 0, 23, 59, 59));
    }
    // Koristimo stroge hotelske operatore (lt i gt) da se datumi smena ne sudaraju!
    where.startDate = { lt: endRange };
    where.endDate = { gt: startRange };
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

    const rangeToken = startMonth && endMonth ? `${startMonth}_${endMonth}` : month || 'all';

    // Kreiramo dinamički ključ na osnovu parametara pretrage (npr. "bookings:2026-07")
    const cacheKey = CACHE_KEYS.BOOKINGS(rangeToken, apartmentId);

    if (shouldCache) {
      const cachedBookings = appCache.get(cacheKey);
      if (cachedBookings) {
        logger.debug({ cacheKey }, '⚡ Cache HIT - Vraćam podatke iz memorije');
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
      ? bookings
      : bookings.map((b) => ({
          ...b,
          guest: 'Zauzeto', // Sakriveno ime
          email: 'skriveno@podaci.com', // Sakriven email
          phone: null, // Sakriven telefon
        }));

    const responsePayload = { bookings: filteredBookings, nextCursor };

    // Keširamo ovaj specifičan mesec/apartman
    if (shouldCache) {
      appCache.set(cacheKey, responsePayload, 1800);
      logger.debug({ cacheKey }, '💾 Cache MISS - Upisano u memoriju');
    }

    res.json(responsePayload);
  } catch (error) {
    logger.error({ err: error }, '❌ getBookings — greška u bazi');
    next(error); // ← Prosleđuje grešku globalnom handleru
  }
};
