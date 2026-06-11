// backend/src/controllers/adminRequests.controller.ts

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { fireAndForget, logger } from '../utils/logger';
import { ApiError } from '@shared/index';
import { appCache, CACHE_KEYS } from '../utils/cache';
import { sendRequestRejectedToGuest } from '../utils/emailService';

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
    { adminId: req.user?.userId },
    '📋 GET /api/bookings/requests/pending — Admin panel',
  );

  try {
    // 1. Čitamo keš ključ 'requests:pending'
    const cachedRequests = appCache.get(CACHE_KEYS.PENDING_REQUESTS);
    if (cachedRequests) {
      res.json(cachedRequests);
      return;
    }
    // 2. Ako nema u kešu, čitamo iz baze sve zahteve sa statusom na čekanju
    const requests = await prisma.reservationRequest.findMany({
      where: { status: 'PENDING_APPROVAL' },
      include: { apartment: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    // 3. 🎯 PUNJENJE KEŠA: Upisujemo listu zahteva u keš
    appCache.set(CACHE_KEYS.PENDING_REQUESTS, requests, 300); // 5 minuta (300 sekundi)
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
    const existingRequest = await prisma.reservationRequest.findUnique({
      where: { id: id },
      include: { apartment: { select: { id: true, name: true } } },
    });

    if (!existingRequest || existingRequest.status !== 'PENDING_APPROVAL') {
      res.status(404).json({ error: 'Zahtev ne postoji ili je već obrađen.' });
      return;
    }

    await prisma.reservationRequest.update({
      where: { id: id, status: 'PENDING_APPROVAL' },
      data: { status: 'REJECTED' },
    });

    // ⚡ INVALIDACIJA KEŠA: Slanje u istoriju briše zahteve sa čekanja
    appCache.del(CACHE_KEYS.PENDING_REQUESTS);
    res.json({ message: 'Zahtev za rezervaciju je uspešno odbijen.' });
    const safePhone =
      existingRequest.phone !== null && existingRequest.phone !== undefined
        ? existingRequest.phone
        : '';

    fireAndForget(
      sendRequestRejectedToGuest({
        id: existingRequest.id,
        guest: existingRequest.guest,
        email: existingRequest.email,
        phone: safePhone,
        startDate: existingRequest.startDate,
        endDate: existingRequest.endDate,
        apartment: existingRequest.apartment,
      }),
      {
        action: 'SEND_REQUEST_REJECTED_EMAIL',
        requestId: existingRequest.id,
      },
    );
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
 * POST /api//bookings/requests/approve
 * 🔑 ADMIN-ONLY: Atomska transakcija za odobrenje i kreiranje rezervacije
 */
// obavlja se u bookings.controler.ts jer uključuje kreiranje rezervacije i provjeru konflikta u transakciji
