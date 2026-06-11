import { Request, Response, NextFunction } from 'express';
import { fireAndForget, logger } from '../utils/logger';
import { prisma } from '../config/prisma';
import { runCombinedBackup } from '../cron/backupCreation';
import { sendBookingConfirmation } from '../utils/emailService';
import { appCache, invalidateBookingCache, CACHE_KEYS } from '../utils/cache';
import { parseStringToUTCDate, normalizeToUTCMidnight, calcNightsUTC } from '../utils/dateUtils';
import { findConflictingBooking, calculateStayPrice } from '../utils/bookingConflict';

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
  const requestBody = req.body as Record<string, unknown>;
  const { requestId } = req.body;
  let bookingData: {
    apartmentId: string;
    guest: string;
    email: string;
    phone: string | null;
    startDate: Date;
    endDate: Date;
    createdAt?: Date;
    capacity: number;
  };
  try {
    // 🛡️ STROGA KONTROLA KAPACITETA SA FRONTENDA (Nema više fallbacks!)
    const rawCapacity = Number(requestBody.capacity);
    if (isNaN(rawCapacity) || rawCapacity <= 0 || !Number.isInteger(rawCapacity)) {
      res.status(400).json({
        error: 'Kritična greška u validaciji sistema.',
        details:
          'Izabrani kapacitet (broj osoba) nije validan. Molimo osvežite stranicu i pokušajte ponovo.',
      });
      return;
    }
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
        createdAt: request.createdAt,
        capacity: rawCapacity, // Čuvamo originalni datum kreiranja zahteva u rezervaciji za evidenciju
      };
    } else {
      // Standardno ručno kreiranje od strane admina — pokrećemo Zod validaciju unosa

      // 🔒 SADA JE OVDE KONAČNA POBEDA: Podaci su već 100% validirani i transformisani u Date objekte
      // od strane našeg pametnog uslovnog middleware-a na ruti! Čitamo ih direktno iz req.body.
      bookingData = {
        apartmentId: String(requestBody.apartmentId || ''),
        guest: String(requestBody.guest || ''),
        email: String(requestBody.email || ''),
        phone: requestBody.phone ? String(requestBody.phone) : null,
        startDate: new Date(requestBody.startDate as string),
        endDate: new Date(requestBody.endDate as string),
        capacity: rawCapacity, // Koristimo strogo proveren kapacitet sa frontenda i ovde
      };
    }

    const utcStartDate = normalizeToUTCMidnight(parseStringToUTCDate(bookingData.startDate));
    const utcEndDate = normalizeToUTCMidnight(parseStringToUTCDate(bookingData.endDate));

    // 🛡️ PRE-TRANSACTION CHECKPOINT:
    // Fast-fail duplicate incoming requests immediately using a standard read query.
    // This offloads traffic from the connection pool, preventing connection timeouts.
    const earlyConflict = await findConflictingBooking(
      prisma,
      bookingData.apartmentId,
      utcStartDate,
      utcEndDate,
    );
    if (earlyConflict) {
      res.status(409).json({ error: 'Termin nije slobodan — postoji preklapajuća rezervacija' });
      return;
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

        // 🆕  Povlačimo sve sezone za ovaj apartman unutar transakcije
        const rates = await tx.apartmentRate.findMany({
          where: { apartmentId: bookingData.apartmentId },
          orderBy: { startDate: 'asc' },
        });

        if (await findConflictingBooking(tx, bookingData.apartmentId, utcStartDate, utcEndDate)) {
          throw new Error('BOOKING_CONFLICT');
        }
        const totalNights = calcNightsUTC(utcStartDate, utcEndDate);
        let serverCalculatedTotalPrice = 0;

        // 🎯 Koristimo bezbedno upakovani kapacitet sa frontenda (Garantuje tačan proračun BUG-03)
        const bookingCapacity = bookingData.capacity;

        // 🎯 POZIV ZAJEDNIČKE FUNKCIJE: Računamo cenu munjevito i 100% bezbedno!
        serverCalculatedTotalPrice = calculateStayPrice(
          rates,
          utcStartDate,
          totalNights,
          bookingCapacity,
        );

        // 3. Kreiranje rezervacije u istoj atomičnoj operaciji
        const newBooking = await tx.booking.create({
          data: {
            apartmentId: bookingData.apartmentId,
            guest: bookingData.guest,
            email: bookingData.email,
            phone: bookingData.phone?.trim() ?? '',
            startDate: utcStartDate,
            endDate: utcEndDate,
            status: 'CONFIRMED',
            totalPrice: serverCalculatedTotalPrice,
            capacity: bookingCapacity,
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
    appCache.del(CACHE_KEYS.PENDING_REQUESTS);

    logger.info(
      { bookingId: booking.id, totalPrice: booking.totalPrice },
      '✅ Rezervacija kreirana unutar transakcije',
    );
    res.status(201).json({ message: 'Rezervacija je uspešno kreirana', booking });

    fireAndForget(sendBookingConfirmation(booking), {
      action: 'SEND_BOOKING_CONFIRMATION_EMAIL',
      bookingId: booking.id,
    });
    // 📊 Excel i backup — fire & forget, ne blokira odgovor
    fireAndForget(runCombinedBackup('booking_mutation'), {
      action: 'SYNC_COMBINED_BACKUP_AFTER_CREATE',
      bookingId: booking.id,
    });
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

      if (error.message && error.message.startsWith('MISSING_RATE_FOR_DATE:')) {
        const missingDate = error.message.split(':')[1] ?? 'nepoznat datum';

        logger.warn(
          { missingDate, apartmentId: req.body?.apartmentId || failedApartmentId },
          '⚠️ Pokušaj kreiranja rezervacije bez definisane cene za datum',
        );

        res.status(422).json({
          error: `Za datum ${missingDate} nije definisana sezonska cena. Molimo admina da postavi cenovnik pre kreiranja rezervacije.`,
        });
        return;
      }
    }

    logger.error({ err: error }, '❌ createBooking — neočekivana greška na transakciji');
    next(error); // ← Prosleđuje grešku globalnom handleru
  }
};
