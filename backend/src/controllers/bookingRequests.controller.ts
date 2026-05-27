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
//  ✅ rejectRequest — Admin odbija zahtev (status → REJECTED)
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';
import { createGuestRequestSchema } from '../validators/booking.validator';
import {
  sendNewRequestToAdmin,
  sendRequestReceivedToGuest,
  sendRequestRejectedToGuest,
} from '../utils/emailService';

// =============================================================================
// 📬 POST /api/bookings/requests
// =============================================================================

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

  //Zod validacija:
  const parseResult = createGuestRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    const firstError = parseResult.error.issues[0]?.message ?? 'Neispravan unos';
    logger.warn(
      { errors: parseResult.error.issues },
      '⚠️ createBookingRequest — validacija neuspešna',
    );
    res.status(400).json({ error: firstError });
    return;
  }
  const { apartmentId, guest, email, phone, startDate, endDate } = parseResult.data;

  try {
    // ─── Provjera konflikta sa potvrđenim rezervacijama ───────────────────────
    //
    // Važna napomena o dizajnu: Provjera konflikta NIJE transakcijska ovdje.
    // Race condition je moguć ali niske vjerovatnoće jer:
    //   a) Zahtjevi idu na odobrenje — admin konačno odlučuje
    //   b) Pri odobravanju (approve), transkacijska provjera se radi ponovo
    //
    // Za direktno kreiranje (POST /api/bookings), koristi se transakcija + FOR UPDATE.
    const conflictingBooking = await prisma.booking.findFirst({
      where: {
        apartmentId,
        status: 'CONFIRMED', // Gledamo samo čvrsto zauzete termine
        // Standardna overlap logika: A↔B se preklapaju ako A.start < B.end i A.end > B.start
        startDate: { lt: new Date(endDate) },
        endDate: { gt: new Date(startDate) },
      },
    });

    if (conflictingBooking) {
      logger.warn({ apartmentId, startDate, endDate }, '⚠️ Zahtev odbijen — termin zauzet');
      res.status(409).json({ error: 'Izabrani termin je u međuvremenu zauzet.' });
      return;
    }

    // ─── Kreiranje zahteva ────────────────────────────────────────────────────
    //
    // Status PENDING_APPROVAL znači: zahtev je primljen i čeka admin odluku.
    // Status PENDING_EMAIL bi koristili ako admin treba e-mail potvrdu — nije u upotrebi.
    //
    // expiresAt: 24 sata od sada — ako admin ne reaguje, cron postavi na EXPIRED.
    // Ovo sprečava nagomilavanje zastarelih zahtjeva u bazi.
    const newRequest = await prisma.reservationRequest.create({
      data: {
        apartmentId: String(apartmentId),
        guest: guest.trim(),
        email: email.trim().toLowerCase(), // Normalizuj email za konzistentnost
        phone: phone?.trim() || '',
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: 'PENDING_APPROVAL',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // +24h
      },
      include: {
        apartment: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    logger.info(
      { requestId: newRequest.id, apartmentId },
      '✅ Zahtev za rezervaciju upisan u bazu',
    );

    // ─── Odgovor klijentu ─────────────────────────────────────────────────────
    //
    // Vraćamo samo ID i poruku — ne vraćamo ceo objekat da ne eksponujemo
    // interne detalje (npr. expiresAt, interne ID-jeve).
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

    // Email adminu — obaveštenje o novom zahtevu
    sendNewRequestToAdmin(emailData).catch((err) => {
      logger.error({ err, requestId: newRequest.id }, '⚠️ Admin email o novom zahtevu nije poslat');
    });

    // Email gostu — potvrda prijema zahteva
    sendRequestReceivedToGuest(emailData).catch((err) => {
      logger.error({ err, requestId: newRequest.id }, '⚠️ Email prijema zahteva gostu nije poslat');
    });
  } catch (error) {
    logger.error({ err: error }, '❌ Greška pri kreiranju zahteva za rezervaciju');
    next(error); // ← Prosleđuje globalnom error handleru
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
    const requests = await prisma.reservationRequest.findMany({
      where: { status: 'PENDING_APPROVAL' },
      include: { apartment: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

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
  const safeId = Array.isArray(id) ? id[0] : id;
  logger.info({ requestId: safeId, adminId: req.user?.userId }, '❌ Odbijanje zahteva pokrenuto');

  if (!safeId || typeof safeId !== 'string') {
    res.status(400).json({ error: 'ID zahteva je obavezan parametar.' });
    return;
  }

  try {
    // Dohvat zahteva pre update-a da bismo imali podatke za email
    const existingRequest = await prisma.reservationRequest.findUnique({
      where: { id: safeId },
      include: { apartment: { select: { id: true, name: true } } },
    });

    if (!existingRequest || existingRequest.status !== 'PENDING_APPROVAL') {
      res.status(404).json({ error: 'Zahtev ne postoji ili je već obrađen.' });
      return;
    }

    const updatedRequest = await prisma.reservationRequest.update({
      where: { id: safeId, status: 'PENDING_APPROVAL' }, // Menjamo samo ako je bio na čekanju
      data: { status: 'REJECTED' },
    });

    logger.info({ requestId: updatedRequest.id }, '✅ Zahtev uspešno označen kao REJECTED');
    res.json({ message: 'Zahtev za rezervaciju je uspešno odbijen.' });

    sendRequestRejectedToGuest({
      id: existingRequest.id,
      guest: existingRequest.guest,
      email: existingRequest.email,
      phone: existingRequest.phone,
      startDate: existingRequest.startDate,
      endDate: existingRequest.endDate,
      apartment: existingRequest.apartment,
    }).catch((err) => {
      logger.error({ err, requestId: existingRequest.id }, '⚠️ Email odbijanja gostu nije poslat');
    });
  } catch (error: any) {
    // P2025 označava da zapis nije pronađen (ili je već odobren/odbijen)
    if (error.code === 'P2025') {
      res.status(404).json({ error: 'Zahtev ne postoji ili je već obrađen.' });
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
    const count = await prisma.reservationRequest.count({
      where: { status: 'PENDING_APPROVAL' },
    });

    res.json({ count });
  } catch (error) {
    logger.error({ err: error }, '❌ getPendingRequestsCount — greška');
    next(error);
  }
};
