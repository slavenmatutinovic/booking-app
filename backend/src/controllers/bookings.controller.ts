/**
 * bookings.controller.ts — CRUD za rezervacije sa email notifikacijama.
 *
 * Sve mutacije (POST, PATCH, DELETE) koriste Prisma interaktivne transakcije
 * sa PostgreSQL FOR UPDATE zaključavanjem reda. Ovo je namerno dizajnirano
 * da spreči race condition kada dva korisnika istovremeno pokušaju da rezervišu
 * isti termin — baza garantuje da samo jedan upis može proći.
 *
 * Tok jedne transakcije:
 *   1. Zaključaj red (FOR UPDATE) — niko drugi ne može čitati/pisati dok ne završimo
 *   2. Provjeri konflikt unutar iste transakcije
 *   3. Izvrši mutaciju
 *   4. Commit (automatski ako nema greške) ili Rollback (ako throw Error)
 *
 * Email notifikacije:
 *   Slanje emaila je "fire and forget" — poziva se bez await posle odgovora klijentu.
 *   Greška u slanju emaila se loguje ali NE blokira HTTP odgovor.
 *   Ovo je namerno: klijent ne treba čekati SMTP round-trip (može biti 1-3 sekunde).
 */

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';
import { Prisma } from '@prisma/client';
import { sendBookingConfirmation, sendBookingCancellation } from '../utils/emailService';
import { createBookingSchema } from '../validators/booking.validator';
import { appCache } from '../utils/cache';
import { ApiError, MAX_BOOKING_DAYS } from '..//../../shared/index';
import { generateBookingExcel } from '../utils/excelExport';

// ─── [SEC-01]: STRIKTNE DEFINICIJE TIPOVA ZA RAW UPITE ────────────────────────
type ApartmentRow = { id: string };
type BookingRow = {
  id: string;
  apartmentId: string;
  startDate: Date | string;
  endDate: Date | string;
  status: string;
};

// ─── GET /api/bookings ─────────────────────────────────────────────────────────
export const getBookings = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { month, apartmentId, limit = '200', cursor } = req.query;
  logger.debug({ query: req.query, userId: req.user?.userId }, '📋 GET /api/bookings');

  const where: Prisma.BookingWhereInput = { status: 'CONFIRMED' };

  if (apartmentId) {
    where.apartmentId = String(apartmentId);
  }

  if (month) {
    const [year, mon] = String(month).split('-').map(Number);
    if (!year || !mon || mon < 1 || mon > 12) {
      res.status(400).json({ error: 'Neispravan format meseca. Koristite YYYY-MM.' });
      return;
    }
    const startOfMonth = new Date(year, mon - 1, 1);
    const endOfMonth = new Date(year, mon, 0, 23, 59, 59);
    where.startDate = { lte: endOfMonth };
    where.endDate = { gte: startOfMonth };
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
    const cacheKey = `bookings:${month || 'all'}:${apartmentId || 'all'}`;

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

// ─── POST /api/bookings ────────────────────────────────────────────────────────
export const createBooking = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  logger.debug({ body: req.body, userId: req.user?.userId }, '📝 POST /api/bookings');

  // 🚀 1. PROVERAVAMO DA LI ODOBRAVAMO POSTOJEĆI ZAHTEV GOSTA
  const { requestId } = req.body;
  let bookingData: {
    apartmentId: string;
    guest: string;
    email: string;
    phone: string | null;
    startDate: Date;
    endDate: Date;
    createdAt?: Date;
  };
  try {
    if (requestId) {
      // Admin je kliknuo "Odobri" na tabeli zahteva
      const request = await prisma.reservationRequest.findUnique({
        where: { id: String(requestId) },
      });

      if (!request || request.status !== 'PENDING_APPROVAL') {
        res.status(404).json({ error: 'Zahtev ne postoji, istakao je ili je već obrađen.' });
        return;
      }

      // Pakujemo podatke iz zahteva za transakciju
      bookingData = {
        apartmentId: request.apartmentId,
        guest: request.guest,
        email: request.email,
        phone: request.phone,
        startDate: request.startDate,
        endDate: request.endDate,
        createdAt: request.createdAt, // Čuvamo originalni datum kreiranja zahteva u rezervaciji za evidenciju
      };
    } else {
      // Standardno ručno kreiranje od strane admina — pokrećemo Zod validaciju unosa

      // 🔒 SADA JE OVDE KONAČNA POBEDA: Podaci su već 100% validirani i transformisani u Date objekte
      // od strane našeg pametnog uslovnog middleware-a na ruti! Čitamo ih direktno iz req.body.
      bookingData = req.body;
    }

    // Pokretanje interaktivne transakcije sa izolacijom i zaključavanjem reda
    const booking = await prisma.$transaction(
      async (tx) => {
        // 1. Provera postojanja apartmana uz zaključavanje reda (Pessimistic Read/Write)
        // Koristi se sirov SQL unutar transakcije da bi se sprečili konkurentni upisi na isti apartman
        const apartments = await tx.$queryRaw<ApartmentRow[]>`
        SELECT id FROM "Apartment" WHERE id = ${bookingData.apartmentId} FOR UPDATE
      `;

        if (!apartments || apartments.length === 0) {
          throw new Error('APARTMENT_NOT_FOUND');
        }

        // 2. Provera konflikta termina unutar bezbednog konteksta transakcije
        const conflictingBooking = await tx.booking.findFirst({
          where: {
            apartmentId: bookingData.apartmentId,
            status: 'CONFIRMED',
            startDate: { lt: bookingData.endDate },
            endDate: { gt: bookingData.startDate },
          },
        });

        if (conflictingBooking) {
          throw new Error('BOOKING_CONFLICT');
        }

        // 3. Kreiranje rezervacije u istoj atomičnoj operaciji
        const newBooking = await tx.booking.create({
          data: {
            apartmentId: bookingData.apartmentId,
            guest: bookingData.guest,
            email: bookingData.email,
            phone: bookingData.phone ?? '',
            startDate: bookingData.startDate,
            endDate: bookingData.endDate,
            status: 'CONFIRMED',
            createdAt: bookingData.createdAt ?? new Date(),
          },
          include: { apartment: { select: { id: true, name: true } } },
        });
        // Bez ovoga zahtev ostaje PENDING_APPROVAL i pojavljuje se ponovo u listi zahteva
        if (requestId) {
          await tx.reservationRequest.update({
            where: { id: String(requestId) },
            data: { status: 'APPROVED' },
          });
          logger.info({ requestId }, '✅ ReservationRequest označen kao APPROVED');
        }

        return newBooking;
      },
      {
        // Postavljanje kraćeg timeout-a za transakciju radi performansi (opciono)
        timeout: 5000,
      },
    );

    // 🚀 [KESH INVALIDACIJA] — OVDE JE TAČNO MESTO ZA ČIŠĆENJE
    // Pošto je transakcija prošla, uzimamo sve ključeve i čistimo isključivo rezervacije
    try {
      const keys = appCache.keys();
      const bookingKeys = keys.filter((key) => key.startsWith('bookings:'));
      bookingKeys.forEach((key) => appCache.del(key));
      logger.debug(`🧹 Obrisano ${bookingKeys.length} ključeva rezervacija iz keša.`);
    } catch (cacheErr) {
      // Greška u kešu ne sme da sruši kreiranje rezervacije, samo je logujemo
      logger.error({ err: cacheErr }, '⚠️ Greška prilikom brisanja keša rezervacija');
    }

    logger.info({ bookingId: booking.id }, '✅ Rezervacija kreirana unutar transakcije');
    res.status(201).json({ message: 'Rezervacija je uspešno kreirana', booking });

    // Fire & forget slanje imejla potvrde gostu
    sendBookingConfirmation(booking).catch((emailErr) => {
      logger.error({ err: emailErr, bookingId: booking.id }, '⚠️ Email potvrde nije poslat');
    });

    // 📊 Excel backup — fire & forget, ne blokira odgovor
    generateBookingExcel(
      requestId
        ? `Odobrena rezervacija (request: ${requestId})`
        : `Kreirana rezervacija: ${booking.id}`,
    );
  } catch (error: unknown) {
    // Obrada specifičnih grešaka koje su bačene unutar transakcije
    const failedApartmentId = req.body?.apartmentId ? String(req.body.apartmentId) : 'unknown';
    if (error instanceof Error) {
      if (error.message === 'APARTMENT_NOT_FOUND') {
        logger.warn({ apartmentId: failedApartmentId }, '⚠️ createBooking — apartman ne postoji');
        res.status(404).json({ error: `Apartman sa ID ${failedApartmentId} ne postoji` });
        return;
      }

      if (error.message === 'BOOKING_CONFLICT') {
        logger.warn(
          { apartmentId: failedApartmentId },
          '⚠️ createBooking — konflikt termina unutar transakcije',
        );
        res.status(409).json({ error: 'Termin nije slobodan — postoji preklapajuća rezervacija' });
        return;
      }
    }

    logger.error({ err: error }, '❌ createBooking — neočekivana greška na transakciji');
    next(error); // ← Prosleđuje grešku globalnom handleru
  }
};

// ─── PATCH /api/bookings/:id ───────────────────────────────────────────────────

export const updateBooking = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const rawId = req.params.id;
  logger.debug(
    { bookingId: rawId, body: req.body, userId: req.user?.userId },
    '✏️ PATCH /api/bookings/:id',
  );

  if (!rawId) {
    const errorResponse: ApiError = { error: 'ID rezervacije je obavezan.' };
    res.status(400).json(errorResponse);
    return;
  }

  const id: string = Array.isArray(rawId) ? String(rawId[0]) : String(rawId);

  const { guest, email, phone, startDate, endDate, status } = req.body as {
    guest?: string;
    email?: string;
    phone?: string | null;
    startDate?: Date; // Već transformisano u Date objekat!
    endDate?: Date; // Već transformisano u Date objekat!
    status?: 'CONFIRMED' | 'CANCELLED';
  };

  try {
    // Pokretanje interaktivne transakcije sa sirovim zaključavanjem redova
    const updatedBooking = await prisma.$transaction(
      async (tx) => {
        // 1. Provera i zaključavanje reda rezervacije koju menjamo da niko drugi ne može da je modifikuje paralelno
        const bookingsForUpdate = await tx.$queryRaw<BookingRow[]>`
        SELECT * FROM "Booking" WHERE id = ${id} FOR UPDATE
      `;
        const existing = bookingsForUpdate[0];

        // Ako element ne postoji (odnosno ako je niz prazan ili null), bacamo grešku
        if (!existing) {
          throw new Error('BOOKING_NOT_FOUND');
        }

        // Kombinujemo stare i nove datume radi validacije konflikta termina
        const finalStartDate = startDate ?? new Date(existing.startDate);
        const finalEndDate = endDate ?? new Date(existing.endDate);
        const finalApartmentId = existing.apartmentId;

        if (finalEndDate <= finalStartDate) {
          throw new Error('INVALID_DATE_RANGE');
        }

        // 2. Ako se menjaju datumi, zaključavamo apartman i proveravamo konflikt sa drugom rezervacijom
        if (startDate || endDate) {
          // Zaključavamo apartman radi bezbedne provere preklapanja
          await tx.$queryRaw`
            SELECT id FROM "Apartment" WHERE id = ${finalApartmentId} FOR UPDATE
          `;

          const conflictingBooking = await tx.booking.findFirst({
            where: {
              apartmentId: finalApartmentId,
              status: 'CONFIRMED',
              id: { not: id }, // Izuzimamo samu sebe iz provere preklapanja
              startDate: { lt: finalEndDate },
              endDate: { gt: finalStartDate },
            },
          });

          if (conflictingBooking) {
            throw new Error('BOOKING_CONFLICT');
          }

          // Provjera MAX_BOOKING_DAYS na kombinovanim datumima
          const diffDays = Math.ceil(
            (finalEndDate.getTime() - finalStartDate.getTime()) / (1000 * 60 * 60 * 24),
          );
          if (diffDays > MAX_BOOKING_DAYS) {
            throw new Error('BOOKING_TOO_LONG');
          }
        }

        // 3. Mapiranje polja za unos u Prisma ažuriranje
        const updateData: Prisma.BookingUpdateInput = {};
        if (guest !== undefined) updateData.guest = guest;
        if (email !== undefined) updateData.email = email;
        if (phone !== undefined) updateData.phone = phone ?? '';
        if (startDate !== undefined) updateData.startDate = startDate;
        if (endDate !== undefined) updateData.endDate = endDate;
        if (status !== undefined) updateData.status = status;

        // 4. Izvršavanje ažuriranja u bazi unutar transakcije
        return await tx.booking.update({
          where: { id },
          data: updateData,
          include: { apartment: { select: { id: true, name: true } } },
        });
      },
      {
        timeout: 5000,
      },
    );

    // 🚀 [KESH INVALIDACIJA] — OVDE JE TAČNO MESTO ZA ČIŠĆENJE
    // Pošto je transakcija prošla, uzimamo sve ključeve i čistimo isključivo rezervacije
    try {
      const keys = appCache.keys();
      const bookingKeys = keys.filter((key) => key.startsWith('bookings:'));
      bookingKeys.forEach((key) => appCache.del(key));
      logger.debug(`🧹 Obrisano ${bookingKeys.length} ključeva rezervacija iz keša.`);
    } catch (cacheErr) {
      // Greška u kešu ne sme da sruši kreiranje rezervacije, samo je logujemo
      logger.error({ err: cacheErr }, '⚠️ Greška prilikom brisanja keša rezervacija');
    }

    logger.info(
      { bookingId: updatedBooking.id },
      '✅ Rezervacija uspešno ažurirana unutar transakcije',
    );
    res.json({ message: 'Rezervacija je uspešno ažurirana', booking: updatedBooking });

    // 📊 Excel backup — fire & forget
    generateBookingExcel(`Izmenjena rezervacija: ${id}`);
  } catch (error: unknown) {
    // Obrada specifičnih transakcionih grešaka
    if (error instanceof Error) {
      if (error.message === 'BOOKING_NOT_FOUND') {
        res.status(404).json({ error: 'Rezervacija ne postoji' });
        return;
      }
      if (error.message === 'INVALID_DATE_RANGE') {
        res.status(400).json({ error: 'Krajnji datum mora biti nakon početnog datuma.' });
        return;
      }
      if (error.message === 'BOOKING_CONFLICT') {
        res
          .status(409)
          .json({ error: 'Novi termin je zauzet, preklapanje sa drugom rezervacijom!' });
        return;
      }
      if (error.message === 'BOOKING_TOO_LONG') {
        res.status(400).json({
          error: `Rezervacija ne može trajati duže od ${MAX_BOOKING_DAYS} dana.`,
        });
        return;
      }
    }

    logger.error({ err: error }, '❌ updateBooking — neočekivana greška na transakciji');
    next(error); // ← Prosleđuje grešku globalnom handleru
  }
};

// ─── DELETE /api/bookings/:id ──────────────────────────────────────────────────
// Soft delete -> Menja status rezervacije u 'CANCELLED' unutar bezbedne transakcije
export const deleteBooking = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { id } = req.params;
  logger.debug(
    { bookingId: id, userId: req.user?.userId },
    '🗑️ DELETE /api/bookings/:id (Soft Delete)',
  );

  const safeId = Array.isArray(id) ? id[0] : id;

  if (!safeId) {
    res.status(400).json({ error: 'ID rezervacije je obavezan.' });
    return;
  }

  try {
    // Pokrećemo transakciju i zaključavamo red kako bismo sprečili race condition tokom otkazivanja
    const cancelledBooking = await prisma.$transaction(
      async (tx) => {
        // 1. Provera postojanja i zaključavanje reda rezervacije
        const bookingsForUpdate = await tx.$queryRaw<BookingRow[]>`
        SELECT id, status FROM "Booking" WHERE id = ${safeId} FOR UPDATE
      `;

        // Izvlačimo prvi element direktno iz niza
        const existing = bookingsForUpdate[0];

        // Ako element ne postoji (odnosno ako je niz prazan ili null), bacamo grešku
        if (!existing) {
          throw new Error('BOOKING_NOT_FOUND');
        }

        // Ako je rezervacija već otkazana, nema potrebe za ponovnim upisom
        if (existing.status === 'CANCELLED') {
          throw new Error('BOOKING_ALREADY_CANCELLED');
        }

        // 2. Izvršavanje soft-delete operacije (prebacivanje u CANCELLED)
        return await tx.booking.update({
          where: { id: safeId },
          data: { status: 'CANCELLED' },
          include: { apartment: { select: { id: true, name: true } } },
        });
      },
      { timeout: 5000 },
    );

    // 🚀 [KESH INVALIDACIJA] — OVDE JE TAČNO MESTO ZA ČIŠĆENJE
    // Pošto je transakcija prošla, uzimamo sve ključeve i čistimo isključivo rezervacije
    try {
      const keys = appCache.keys();
      const bookingKeys = keys.filter((key) => key.startsWith('bookings:'));
      bookingKeys.forEach((key) => appCache.del(key));
      logger.debug(`🧹 Obrisano ${bookingKeys.length} ključeva rezervacija iz keša.`);
    } catch (cacheErr) {
      // Greška u kešu ne sme da sruši kreiranje rezervacije, samo je logujemo
      logger.error({ err: cacheErr }, '⚠️ Greška prilikom brisanja keša rezervacija');
    }

    logger.info(
      { bookingId: cancelledBooking.id },
      '✅ Rezervacija uspešno otkazana (Soft Delete)',
    );
    res.json({ message: 'Rezervacija je uspešno otkazana', booking: cancelledBooking });

    // Email obaveštenje o otkazivanju — fire & forget
    sendBookingCancellation(cancelledBooking).catch((emailErr) => {
      logger.error(
        { err: emailErr, bookingId: cancelledBooking.id },
        '⚠️ Email otkazivanja nije poslat',
      );
    });
    // 📊 Excel backup — fire & forget
    generateBookingExcel(`Otkazana rezervacija: ${safeId}`);
  } catch (error: unknown) {
    // Rukovanje greškama usklađeno sa Zod v4 i TypeScript unknown standardom
    if (error instanceof Error) {
      if (error.message === 'BOOKING_NOT_FOUND') {
        res.status(404).json({ error: 'Rezervacija ne postoji' });
        return;
      }
      if (error.message === 'BOOKING_ALREADY_CANCELLED') {
        res.status(400).json({ error: 'Rezervacija je već ranije otkazana.' });
        return;
      }
    }

    logger.error({ err: error }, '❌ deleteBooking — unutrašnja greška na transakciji');
    next(error); // ← Prosleđuje grešku globalnom handleru
  }
};
