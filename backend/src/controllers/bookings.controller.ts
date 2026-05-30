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
import { ApiError, MAX_BOOKING_DAYS } from '../../../shared/index';
import { triggerDebouncedExcelBackup } from '../utils/excelExport';
import { sendBookingCancellation } from '../utils/emailService';
import { invalidateBookingCache } from '../utils/cache';

type BookingRow = {
  id: string;
  apartmentId: string;
  startDate: Date | string;
  endDate: Date | string;
  status: string;
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
    invalidateBookingCache();

    logger.info(
      { bookingId: updatedBooking.id },
      '✅ Rezervacija uspešno ažurirana unutar transakcije',
    );
    res.json({ message: 'Rezervacija je uspešno ažurirana', booking: updatedBooking });

    // 📊 Excel backup — fire & forget
    triggerDebouncedExcelBackup(`Izmenjena rezervacija: ${id}`);
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

    invalidateBookingCache();

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
    triggerDebouncedExcelBackup(`Otkazana rezervacija: ${safeId}`);
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
