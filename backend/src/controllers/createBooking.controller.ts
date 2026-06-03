import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { prisma } from '../config/prisma';
import { runCombinedBackup } from '../cron/backupCreation';
import { sendBookingConfirmation } from '../utils/emailService';
import { invalidateBookingCache } from '../utils/cache';

// ─── [SEC-01]: STRIKTNE DEFINICIJE TIPOVA ZA RAW UPITE ────────────────────────
type ApartmentRow = { id: string };

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
        const cleanStartDate = new Date(bookingData.startDate);
        cleanStartDate.setUTCHours(0, 0, 0, 0);

        const cleanEndDate = new Date(bookingData.endDate);
        cleanEndDate.setUTCHours(0, 0, 0, 0);

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
            startDate: { lt: cleanEndDate }, // Ključni hotelski operator: startDate mora biti strogo manje od endDate novog zahteva
            endDate: { gt: cleanStartDate }, // Ključni hotelski operator: endDate mora biti strogo veći od startDate novog zahteva
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
            startDate: cleanStartDate,
            endDate: cleanEndDate,
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
    invalidateBookingCache();

    logger.info({ bookingId: booking.id }, '✅ Rezervacija kreirana unutar transakcije');
    res.status(201).json({ message: 'Rezervacija je uspešno kreirana', booking });

    // Fire & forget slanje imejla potvrde gostu
    sendBookingConfirmation(booking).catch((emailErr) => {
      logger.error({ err: emailErr, bookingId: booking.id }, '⚠️ Email potvrde nije poslat');
    });

    // 📊 Excel backup — fire & forget, ne blokira odgovor
    runCombinedBackup(
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
