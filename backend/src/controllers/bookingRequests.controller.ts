// =============================================================================
// 📬 backend/src/controllers/bookingRequests.controller.ts
// =============================================================================
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  ZAHTEVI ZA REZERVACIJU — Javni endpoint (bez prijave)                  │
// │                                                                         │
// │  Tok zahteva gosta:                                                     │
// │    1. Gost popuni formu u kalendaru (ime, email, datumi)                │
// │    2. POST /api/bookings/requests — bez autentikacije                   │
// │    3. Server provjeri da termin nije već zauzet                         │
// │    4. Zahtev se upiše u ReservationRequest tabelu (status: PENDING)     │
// │    5. Admin vidi zahtev i odobrava ili odbija                           │
// │                                                                         │
// │  Razlika od POST /api/bookings:                                         │
// │    • /api/bookings → Admin direktno kreira POTVRĐENU rezervaciju        │
// │    • /api/bookings/requests → Gost šalje ZAHTEV koji čeka odobrenje     │
// └─────────────────────────────────────────────────────────────────────────┘
//
// 🔒 BEZBEDNOSNE NAPOMENE:
//
//   ⚠️  Ovaj endpoint je JAVNO DOSTUPAN — nema autentikacije.
//   Svako može pozvati POST /api/bookings/requests.
//   Zato su sledeće mjere zaštite obavezne:
//
//   1. Zod validacija (SEC-01) — sve vrednosti iz req.body MORAJU
//      proći kroz šemu pre upisa u bazu. Bez ovoga, napadač može
//      upisati XSS payload u kolonu `guest` koji se prikazuje u admin UI.
//
//   2. Rate limiting (u server.ts) — logLimiter blokira više od
//      30 zahteva po minuti po IP adresi.
//
//   3. expiresAt — zahtevi automatski ističu posle 24h ako ih admin
//      ne pregleda. Cron (cleanupCron.ts) ih označava kao EXPIRED.
//
//   4. Konflikt provjera — ne dozvoljava zahtev za termin koji je
//      već POTVRĐEN. Dupli zahtevi (isti termin, isti gost) su dozvoljeni
//      jer admin sam odlučuje.
//
// 📋 ODGOVORNOSTI OVOG KONTROLERA:
//
//   ✅ createBookingRequest — Kreira novi zahtev za odobrenje
//   ✅ getPendingRequests — Admin vidi listu svih PENDING zahteva
//   ✅ rejectRequest — Admin odbija zahtev (status → REJECTED)
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';
import { createGuestRequestSchema } from '../validators/booking.validator';
import {
  sendNewRequestToAdmin,
  sendRequestReceivedToGuest,
  sendRequestRejectedToGuest,
  sendBookingConfirmation,
} from '../utils/emailService';
import { appCache, CACHE_KEYS } from '../utils/cache';
import { ApiError, RequestStatus } from '@shared/index';
import { Mutex } from 'async-mutex'; // ⚡ UVOZIMO MEMORIJSKI KATANAC

// =============================================================================
// 📬 POST /api/bookings/requests
// =============================================================================

// Kreiramo centralnu mapu katanaca u memoriji servera (ApartmentId -> Mutex katanac)
const apartmentLocks = new Map<string, Mutex>();

/**
 * Pomoćna funkcija koja bezbedno vraća ili kreira katanac za konkretan apartman
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
 * Prihvata zahtev za rezervaciju od neprijavljenog gosta ili viewer-a.
 *
 * Endpoint je namerno javan — gost ne mora imati nalog da bi poslao zahtev.
 * Validnost termina admin provjerava ručno pri odobravanju.
 *
 * Uspješan odgovor: 201 Created + { message, data: ReservationRequest }
 * Greška — zauzet termin: 409 Conflict
 * Greška — validacija: 400 Bad Request (kada se doda Zod šema)
 */
export const createBookingRequest = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  logger.debug(
    { body: { ...req.body, email: '[REDACTED]' } }, // ← Ne loguj email u debug modu
    '📬 POST /api/bookings/requests',
  );

  const MAX_PENDING_PER_SLOT = 5; // 👈 DEFINIŠI MAKSIMALAN BROJ ZAHTEVA PO TERMINU

  try {
    // ─── Provjera konflikta sa potvrđenim rezervacijama ───────────────────────
    //
    // Važna napomena o dizajnu: Provjera konflikta NIJE transakcijska ovdje.
    // Race condition je moguć ali niske vjerovatnoće jer:
    //   a) Zahtjevi idu na odobrenje — admin konačno odlučuje
    //   b) Pri odobravanju (approve), transkacijska provjera se radi ponovo
    //
    // Za direktno kreiranje (POST /api/bookings), koristi se transakcija + FOR UPDATE.

    // Pošto rute štiti validateBody(createGuestRequestSchema),
    // podaci su već 100% validirani, a startDate i endDate su VAŽEĆI Date objekti!
    const { apartmentId, guest, email, phone, startDate, endDate } = req.body as {
      apartmentId: string;
      guest: string;
      email: string;
      phone: string;
      startDate: Date; // Zod v4.4.3 transformisao string u Date
      endDate: Date; // Zod v4.4.3 transformisao string u Date
    };

    // 🔒 DOHVATAMO KATANAC IZ MEMORIJE ZA OVAJ APARTMAN
    const mutex = getApartmentMutex(apartmentId);

    // runExclusive blokira sve ostale async niti u Node.js-u za ovaj apartman.
    // Nit ulazi unutra, obavlja brz posao sa bazom i izlazi, tek onda propušta sledeću!
    const newRequest = await mutex.runExclusive(async () => {
      // 1. PROVERA KONFLIKTA SA POTVRĐENIM REZERVACIJAMA (Standardni, ultra-brzi upit)
      const conflictingBooking = await prisma.booking.findFirst({
        where: {
          apartmentId,
          status: 'CONFIRMED',
          startDate: { lt: endDate },
          endDate: { gt: startDate },
        },
      });

      if (conflictingBooking) {
        throw new Error('Izabrani termin je u međuvremenu zauzet potvrđenom rezervacijom.');
      }

      // 2. TAČNO I BEZBEDNO BROJANJE ZAHTEVA NA ČEKANJU (Čita iz baze hronološki jedan po jedan)
      const currentPendingCount = await prisma.reservationRequest.count({
        where: {
          apartmentId,
          status: 'PENDING_APPROVAL',
          startDate: { lt: endDate },
          endDate: { gt: startDate },
        },
      });

      if (currentPendingCount >= MAX_PENDING_PER_SLOT) {
        throw new Error(
          `Lista čekanja za ovaj termin je puna. Maksimalan broj zahteva na pregledu je ${MAX_PENDING_PER_SLOT}.`,
        );
      }

      // 3. KREIRANJE ZAHTEVA U BAZI (Običan, lagan upit - nema više teške transakcije!)
      const pendingStatus: RequestStatus = 'PENDING_APPROVAL';
      return await prisma.reservationRequest.create({
        data: {
          apartmentId: String(apartmentId),
          guest: guest.trim(),
          email: email.trim().toLowerCase(),
          phone: phone?.trim() || '',
          startDate: startDate,
          endDate: endDate,
          status: pendingStatus,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // +24h
        },
        include: {
          apartment: { select: { id: true, name: true } },
        },
      });
    });

    // ─── SVE ISPOD OVE LINIJE SE IZVRŠAVA NAKON ŠTO JE KATANAC OSREĐEN ───────
    // Node.js je već propustio sledeći zahtev iz reda, a mi na miru završavamo mrežni rad

    appCache.del(CACHE_KEYS.PENDING_REQUESTS);

    logger.info(
      { requestId: newRequest.id, apartmentId },
      '✅ Zahtev za rezervaciju upisan u bazu',
    );

    res.status(201).json({
      message: 'Vaš zahtev je uspešno prosleđen adminu na odobrenje.',
      requestId: newRequest.id,
    });

    const emailData = {
      id: newRequest.id,
      guest: newRequest.guest,
      email: newRequest.email,
      phone: newRequest.phone,
      startDate: newRequest.startDate,
      endDate: newRequest.endDate,
      apartment: newRequest.apartment,
    };

    sendNewRequestToAdmin(emailData).catch((err) => logger.error(err));
    sendRequestReceivedToGuest(emailData).catch((err) => logger.error(err));
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error ? error.message : 'Izabrani termin je zauzet ili je lista puna.';
    logger.warn(
      { apartmentId: req.body.apartmentId, errorMsg },
      '⚠️ createBookingRequest — zahtev bezbedno odbijen preko Mutex-a',
    );

    const isLimitError = errorMsg.includes('Lista čekanja');
    const errorResponse: ApiError = { error: errorMsg };
    res.status(isLimitError ? 429 : 409).json(errorResponse);
  }
};

/**
 * GET /api/bookings/requests/pending
 * 🔑 ADMIN-ONLY: Vraća listu svih aktivnih zahteva gostiju na čekanju
 */
export const getPendingRequests = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  logger.debug(
    { userId: req.user?.userId },
    '📋 GET /api/bookings/requests/pending — Admin pregled',
  );

  try {
    // Prvo proveravamo da li imamo keširanu listu zahteva
    const cachedRequests = appCache.get(CACHE_KEYS.PENDING_REQUESTS);
    if (cachedRequests) {
      res.json(cachedRequests);
      return;
    }

    const requests = await prisma.reservationRequest.findMany({
      where: { status: 'PENDING_APPROVAL' },
      include: { apartment: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    appCache.set(CACHE_KEYS.PENDING_REQUESTS, requests, 600); // Keširamo na 10 minuta

    res.json(requests);
  } catch (error) {
    logger.error({ err: error }, '❌ getPendingRequests — greška pri listanju zahteva');
    next(error);
  }
};

/**
 * PATCH /api/bookings/requests/:id/reject
 * 🔑 ADMIN-ONLY: Odbija zahtev gosta (menja status u REJECTED)
 */
export const rejectRequest = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { id } = req.params;

  logger.info({ requestId: id, adminId: req.user?.userId }, '❌ Odbijanje zahteva pokrenuto');

  if (!id || typeof id !== 'string') {
    const errorResponse: ApiError = { error: 'ID zahteva je obavezan parametar.' };
    res.status(400).json(errorResponse);
    return;
  }

  try {
    // Dohvat zahteva pre update-a da bismo imali podatke za email
    const existingRequest = await prisma.reservationRequest.findUnique({
      where: { id: id },
      include: { apartment: { select: { id: true, name: true } } },
    });

    if (!existingRequest || existingRequest.status !== 'PENDING_APPROVAL') {
      const errorResponse: ApiError = { error: 'Zahtev ne postoji ili je već obrađen.' };
      res.status(404).json(errorResponse);
      return;
    }

    const updatedRequest = await prisma.reservationRequest.update({
      where: { id: id, status: 'PENDING_APPROVAL' }, // Menjamo samo ako je bio na čekanju
      data: { status: 'REJECTED' },
    });

    // ⚡ INVALIDACIJA KEŠA: Slanje u istoriju briše zahteve sa čekanja
    appCache.del(CACHE_KEYS.PENDING_REQUESTS);

    logger.info({ requestId: updatedRequest.id }, '✅ Zahtev uspešno označen kao REJECTED');
    res.json({ message: 'Zahtev za rezervaciju je uspešno odbijen.' });

    const safePhone =
      existingRequest.phone !== null && existingRequest.phone !== undefined
        ? existingRequest.phone
        : '';

    sendRequestRejectedToGuest({
      id: existingRequest.id,
      guest: existingRequest.guest,
      email: existingRequest.email,
      phone: safePhone,
      startDate: existingRequest.startDate,
      endDate: existingRequest.endDate,
      apartment: existingRequest.apartment,
    }).catch((err: unknown) => {
      const errorMsg = err instanceof Error ? err.message : 'Nepoznata greška';
      logger.error(
        { err, requestId: existingRequest.id },
        `⚠️ Email odbijanja gostu nije poslat: ${errorMsg}`,
      );
    });
  } catch (error: unknown) {
    // P2025 označava da zapis nije pronađen (ili je već odobren/odbijen)
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
      const errorResponse: ApiError = { error: 'Zahtev ne postoji ili je već obrađen/odbijen.' };
      res.status(404).json(errorResponse);
      return;
    }
    logger.error({ err: error }, '❌ rejectRequest — neočekivana greška');
    next(error);
  }
};

// =============================================================================
// 📊 GET /api/bookings/requests/count — [NOVO] Broj pending zahteva za badge
// =============================================================================

export const getPendingRequestsCount = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Optimizacija: Ako već imamo keširanu listu svih zahteva, čitamo njen .length (brže od DB upita!)
    const cachedRequests = appCache.get<any[]>(CACHE_KEYS.PENDING_REQUESTS);
    if (cachedRequests) {
      res.json({ count: cachedRequests.length });
      return;
    }

    const count = await prisma.reservationRequest.count({
      where: { status: 'PENDING_APPROVAL' },
    });

    res.json({ count });
  } catch (error) {
    logger.error({ err: error }, '❌ getPendingRequestsCount — greška');
    next(error);
  }
};

/**
 * POST /api/bookings/requests/approve
 * 🔑 ADMIN-ONLY: Atomska transakcija za odobrenje i kreiranje rezervacije
 */
// obavlja se u bookings.controler.ts jer uključuje kreiranje rezervacije i provjeru konflikta u transakciji
