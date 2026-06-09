// backend/src/controllers/guestRequests.controller.ts

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';
import { randomUUID } from 'crypto';
import { appCache, CACHE_KEYS, invalidateBookingCache } from '../utils/cache';
import { Mutex } from 'async-mutex';
import { sendNewRequestToAdmin, sendRequestReceivedToGuest } from '../utils/emailService';
import { env } from '../config/env';
import { findConflictingBooking } from '../utils/bookingConflict';
import { normalizeToUTCMidnight, parseStringToUTCDate } from '../utils/dateUtils';

// Centralna mapa katanaca u memoriji servera (ApartmentId -> Mutex katanac)
const apartmentLocks = new Map<string, Mutex>();

/**
 * 🔒 BEZBEDAN IN-MEMORY KATANAC
 * Pošto aplikacija radi isključivo u jednoj instanci, vraćamo brzi in-memory mutex.
 * ✅ OPTIMIZOVANO: Ako katanac više nije aktivan (niko ne čeka na njega),
 *                 čistimo ga iz mape kako bismo sprečili curenje memorije (Memory Leak).
 */
const getApartmentMutex = (apartmentId: string): Mutex => {
  let mutex = apartmentLocks.get(apartmentId);
  if (!mutex) {
    mutex = new Mutex();
    apartmentLocks.set(apartmentId, mutex);
  }
  return mutex;
};

/**
 * Pomoćna funkcija za čišćenje neaktivnih katanaca iz RAM memorije
 */
const releaseApartmentMutex = (apartmentId: string, mutex: Mutex): void => {
  // Ako nema drugih asinhronih niti koje čekaju u redu na ovaj stan, bezbedno brišemo katanac
  if (!mutex.isLocked()) {
    apartmentLocks.delete(apartmentId);
  }
};

/**
 * POST /api/bookings/requests
 * Faza 1: Prima formu od gosta, generiše token i zaključava u PENDING_EMAIL statusu na 2 sata.
 */
export const createBookingRequest = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  logger.debug(
    { body: { ...req.body, email: '[REDACTED]' } },
    '📬 POST /api/bookings/requests (Faza 1 - PENDING_EMAIL)',
  );

  try {
    const { apartmentId, guest, email, phone, startDate, endDate } = req.body as {
      apartmentId: string;
      guest: string;
      email: string;
      phone: string;
      startDate: string | Date;
      endDate: string | Date;
    };
    // 🔒 100% STRIKTAN UTC: Normalizujemo dolazne datume pre ulaska u bazu

    const utcStartDate = normalizeToUTCMidnight(parseStringToUTCDate(startDate));

    const utcEndDate = normalizeToUTCMidnight(parseStringToUTCDate(endDate));

    const emailTimeout = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 sata u ms
    const token = randomUUID();

    // 🛡️ POKRETANJE TRANSAKCIJE: Zaključavamo proces upisa zahteva radi apsolutne sigurnosti podataka
    const newRequest = await prisma.$transaction(async (tx) => {
      // 1. Izvršavamo sirovi PostgreSQL row-level lock nad apartmanom da zaustavimo paralelne niti
      await tx.$executeRaw`SELECT id FROM "Apartment" WHERE id = ${apartmentId} FOR UPDATE`;

      // 2. Proveravamo konflikt unutar tekuće izolovane transakcije (tx) [N-01]
      const isConflicting = await findConflictingBooking(tx, apartmentId, utcStartDate, utcEndDate);
      if (isConflicting) {
        throw new Error('BOOKING_ALREADY_TAKEN');
      }

      // 3. Ako je termin slobodan, kreiramo privremeni zahtev gosta unutar iste transakcije
      return await tx.reservationRequest.create({
        data: {
          apartmentId: String(apartmentId),
          guest: guest.trim(),
          email: email.trim().toLowerCase(),
          phone: phone?.trim() || '',
          startDate: utcStartDate,
          endDate: utcEndDate,
          status: 'PENDING_EMAIL',
          emailToken: token,
          expiresAt: emailTimeout,
        },
        include: {
          apartment: { select: { id: true, name: true } },
        },
      });
    });

    const verificationLink = `${env.BACKEND_URL}/api/bookings/verify?token=${token}`;

    // Fire & Forget email slanje sa obaveznim osiguranjem Promise-a od nepostojećih mockova
    const guestEmailPromise = sendRequestReceivedToGuest({
      id: newRequest.id,
      guest: newRequest.guest,
      email: newRequest.email,
      phone: newRequest.phone,
      startDate: newRequest.startDate,
      endDate: newRequest.endDate,
      apartment: newRequest.apartment,
      verificationLink,
    });

    if (guestEmailPromise instanceof Promise) {
      guestEmailPromise.catch((err: unknown) => {
        logger.error({ err }, '📧 Pozadinsko slanje email obaveštenja gostu nije uspelo');
      });
    }

    logger.info(
      { requestId: newRequest.id },
      '✅ Zahtev upisan pod transakcijskom zaštitom PENDING_EMAIL',
    );

    res.status(201).json({
      message: 'Zahtev primljen. Molimo potvrdite vašu rezervaciju preko email-a u roku od 2 sata.',
      requestId: newRequest.id,
    });
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : '';

    if (errMessage === 'BOOKING_ALREADY_TAKEN') {
      res
        .status(409)
        .json({ error: 'Izabrani termin je u međuvremenu zauzet potvrđenom rezervacijom.' });
      return;
    }

    logger.error({ err: error }, '❌ createBookingRequest — neočekivana greška u transakciji');
    next(error);
  }
};

/**
 * GET /api/bookings/requests/verify
 * Faza 2: Gost je kliknuo na link. Proveravamo Mutex i kapacitet liste čekanja, pa puštamo adminu.
 */
export const verifyReservationEmail = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { token } = req.query;
  const MAX_PENDING_PER_SLOT = 5;

  if (!token) {
    res.status(400).send('<h1>Greška: Verifikacioni token nedostaje.</h1>');
    return;
  }

  try {
    const targetRequest = await prisma.reservationRequest.findUnique({
      where: { emailToken: String(token) },
      include: { apartment: { select: { id: true, name: true } } },
    });

    const nowUTC = new Date();
    if (
      !targetRequest ||
      targetRequest.status !== 'PENDING_EMAIL' ||
      targetRequest.expiresAt < nowUTC
    ) {
      res
        .status(404)
        .send('<h1>Verifikacija neuspešna: Link je nevažeći ili je istekao rok od 2 sata.</h1>');
      return;
    }

    const mutex = getApartmentMutex(targetRequest.apartmentId);

    // Ulazimo u izolovanu async nit za ovaj apartman
    const updatedRequest = await mutex.runExclusive(async () => {
      if (
        await findConflictingBooking(
          prisma,
          targetRequest.apartmentId,
          targetRequest.startDate,
          targetRequest.endDate,
        )
      ) {
        throw new Error('Izabrani termin je u međuvremenu zauzet potvrđenom rezervacijom.');
      }

      const currentPendingCount = await prisma.reservationRequest.count({
        where: {
          apartmentId: targetRequest.apartmentId,
          status: 'PENDING_APPROVAL',
          startDate: { lt: targetRequest.endDate },
          endDate: { gt: targetRequest.startDate },
        },
      });

      if (currentPendingCount >= MAX_PENDING_PER_SLOT) {
        throw new Error(
          `Lista čekanja za ovaj termin je puna. Maksimalan broj zahteva na pregledu je ${MAX_PENDING_PER_SLOT}.`,
        );
      }

      const adminApprovalTimeout = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tačno 24 sata u milisekundama
      logger.info(
        { adminApprovalTimeout: adminApprovalTimeout.toISOString() },
        '📬 Generisan stabilan rok za admin odobrenje zahteva',
      );

      return await prisma.reservationRequest.update({
        where: { id: targetRequest.id },
        data: {
          status: 'PENDING_APPROVAL',
          emailToken: null, // Jednokratna upotreba linka
          expiresAt: adminApprovalTimeout,
        },
      });
    });

    // ✅ DODATO: Odmah nakon oslobađanja katanca, čistimo mapu ako je stan slobodan
    releaseApartmentMutex(targetRequest.apartmentId, mutex);

    appCache.del(CACHE_KEYS.PENDING_REQUESTS);
    invalidateBookingCache();

    logger.info(
      { requestId: updatedRequest.id },
      '🚀 Zahtev uspešno potvrđen i prebačen u PENDING_APPROVAL',
    );

    // Obaveštavamo admina tek nakon uspešne email verifikacije
    const adminEmailPromise = sendNewRequestToAdmin({
      id: targetRequest.id,
      guest: targetRequest.guest,
      email: targetRequest.email,
      phone: targetRequest.phone || '',
      startDate: targetRequest.startDate,
      endDate: targetRequest.endDate,
      apartment: targetRequest.apartment,
    });

    if (adminEmailPromise instanceof Promise) {
      adminEmailPromise.catch((err: unknown) => {
        logger.error({ err }, '📧 Pozadinsko slanje email obaveštenja adminu nije uspelo');
      });
    }

    res.status(200).send(`
      <div style="font-family: sans-serif; text-align: center; padding: 50px; background-color: #f9fafb; min-height: 100vh;">
        <div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
          <h1 style="color: #10b981; margin-bottom: 10px;">Email uspešno verifikovan! 🎉</h1>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">Vaš zahtev je potvrđen i prosleđen administraciji na pregled.</p>
        </div>
      </div>
    `);
  } catch (error: unknown) {
    // 1. 🚨 LOG CRITICAL INFRASTRUCTURE FAILURES
    logger.error({ err: error }, '❌ verifyReservationEmail exception caught');

    // 2. 🛡️ IDENTIFY INTENTIONAL CONFLICTS FROM INTERACTIVE TRANSACTIONS
    // This checks if your custom validation threw a known booking overlap error message
    const isBookingConflict =
      error instanceof Error &&
      (error.message.includes('zauzet') ||
        error.message.includes('puna') ||
        error.message.includes('Overlap'));

    if (isBookingConflict) {
      res.status(409).send(`
      <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
        <h1 style="color: #ef4444;">Zahtev odbijen</h1>
        <p style="color: #4b5563;">Izabrani termin je u međuvremenu zauzet. Molimo Vas izaberite drugi datum.</p>
        <a href="${env.FRONTEND_URL}" style="color: #2563eb; text-decoration: underline;">Nazad na kalendar</a>
      </div>
    `);
      return;
    }

    // 3. 💥 CASCADING INFRASTRUCTURE FAILURE (DB Down, Connection Timeout, Syntax Fault)
    // Pass it down to the global error middleware to fire a clean 500 status code
    next(error);
  }
};
