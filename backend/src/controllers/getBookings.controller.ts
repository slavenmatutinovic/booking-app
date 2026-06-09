import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';
import { Prisma } from '@prisma/client';
import { appCache, CACHE_KEYS } from '../utils/cache';
import { getUTCMonthRange, parseStringToUTCDate } from '../utils/dateUtils';

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

  let startRange: Date;
  let endRange: Date;

  if (typeof startMonth === 'string' && typeof endMonth === 'string' && startMonth && endMonth) {
    // ✅  Veštački dopunjavamo stringove na pun YYYY-MM-DD format
    // startMonth ("2026-05") dopunjujemo na prvi dan u mesecu -> "2026-05-01"
    const fullStartStr = `${startMonth}-01`;

    // endMonth ("2026-06") dopunjujemo na prvi dan u mesecu -> "2026-06-01"
    const fullEndStr = `${endMonth}-01`;

    const parsedStartDate = parseStringToUTCDate(fullStartStr);
    const parsedEndDate = parseStringToUTCDate(fullEndStr);

    // Izvlačimo čistu godinu i mesec iz bezbedno dobijenih UTC objekata
    const sYear = parsedStartDate.getUTCFullYear();
    const sMon = parsedStartDate.getUTCMonth() + 1; // getUTCMonth vraća 0-11

    const eYear = parsedEndDate.getUTCFullYear();
    const eMon = parsedEndDate.getUTCMonth() + 1;

    // Koristimo dateUtils da generišemo konačne matematičke UTC granice za te mesece
    startRange = getUTCMonthRange(sYear, sMon).start;
    endRange = getUTCMonthRange(eYear, eMon).end;
  } else {
    // 🛡️  Safe single-parameter parsing if range boundaries are missing
    const queryMonthStr = req.query.month as string | undefined;
    let targetYear = new Date().getUTCFullYear();
    let targetMonth = new Date().getUTCMonth() + 1; // Default to current UTC month index

    // Check if the query parameter is passed using the clean "YYYY-MM" string format
    if (typeof queryMonthStr === 'string' && queryMonthStr.includes('-')) {
      try {
        // Safe protection: artificially pad to full YYYY-MM-DD to leverage your secure date utility
        const parsedUtcObject = parseStringToUTCDate(`${queryMonthStr}-01`);
        targetYear = parsedUtcObject.getUTCFullYear();
        targetMonth = parsedUtcObject.getUTCMonth() + 1;
      } catch {
        logger.warn(
          { queryMonthStr },
          '⚠️ Invalid single month format passed. Falling back to default system frame.',
        );
      }
    } else {
      // Inline parsing for legacy raw numerical parameters if passed separately (?year=2026&month=6)
      targetYear = parseInt(req.query.year as string, 10) || targetYear;
      targetMonth = parseInt(req.query.month as string, 10) || targetMonth;
    }

    // Pass mathematically audited values to resolve accurate UTC boundaries
    const singleMonthPeriod = getUTCMonthRange(targetYear, targetMonth);
    startRange = singleMonthPeriod.start;
    endRange = singleMonthPeriod.end;
  }

  logger.info(
    { startRange: startRange.toISOString(), endRange: endRange.toISOString() },
    '🔍 getBookings — Raspon uspešno izračunat upotrebom parseStringToUTCDate parsera',
  );
  // Koristimo stroge hotelske operatore (lt i gt) da se datumi smena ne sudaraju!
  where.startDate = { lt: endRange };
  where.endDate = { gt: startRange };

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

    const isAuthenticated = !!req.user;

    // Kreiramo dinamički ključ na osnovu parametara pretrage (npr. "bookings:2026-07")
    const baseCacheKey = CACHE_KEYS.BOOKINGS(
      typeof startMonth === 'string' ? startMonth : rangeToken,
      typeof endMonth === 'string' ? endMonth : undefined,
      apartmentId,
    );
    const cacheKey = `${baseCacheKey}:${isAuthenticated ? 'auth' : 'anon'}`;

    if (shouldCache) {
      // Koristimo ugrađenu Record strukturu umesto novih interfejsa
      const cachedBookings = appCache.get<Record<string, unknown>>(cacheKey);
      if (cachedBookings) {
        logger.debug({ cacheKey }, '⚡ Cache HIT - Bezbedno vraćam izolovane podatke iz memorije');
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
    const filteredBookings = isAuthenticated
      ? bookings.map((b) => {
          // Kastujemo element u nepoznati Record objekat da bismo bezbedno i čisto prepisali totalPrice tip
          const rawBooking = b as unknown as Record<string, unknown>;
          return {
            ...rawBooking,
            totalPrice: Number(b.totalPrice), // Zod v4 i Prisma v7 kompatibilna transformacija Decimal-a u Number
          };
        })
      : bookings.map((b) => {
          const rawBooking = b as unknown as Record<string, unknown>;
          return {
            ...rawBooking,
            guest: 'Zauzeto', // Sakriveno ime
            email: null, // Sakriven email
            phone: null, // Sakriven telefon
            totalPrice: 0, // Finansijska zaštita podataka za anonimne korisnike
          };
        });

    const responsePayload = { bookings: filteredBookings, nextCursor };

    // Keširamo ovaj specifičan mesec/apartman u njegovu sopstvenu fioku
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
