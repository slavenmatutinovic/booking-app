// =============================================================================
// 🧪 backend/src/tests/cache-invalidation.test.ts
// =============================================================================
//
// Testira da keš invalidacija radi ispravno nakon svih mutacija.
//
// Kritični bug koji se testira ovde:
//   • PENDING_REQUESTS keš se ne čisti posle approve (bug u createBooking.controller.ts)
//   • Booking keš se čisti posle create/update/delete
//   • Apartment keš se čisti posle izmena apartmana
//
// Pokretanje:
//   cd backend && npm test cache-invalidation
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';

jest.mock('../middleware/authMiddleware', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'cache-admin-id', role: 'ADMIN' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'cache-admin-id', role: 'ADMIN' };
    next();
  },
}));

jest.mock('../utils/emailService', () => ({
  sendBookingConfirmation: jest.fn().mockResolvedValue(undefined),
  sendBookingCancellation: jest.fn().mockResolvedValue(undefined),
  sendBookingModification: jest.fn().mockResolvedValue(undefined),
  sendNewRequestToAdmin: jest.fn().mockResolvedValue(undefined),
  sendRequestReceivedToGuest: jest.fn().mockResolvedValue(undefined),
  sendRequestRejectedToGuest: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../cron/backupCreation', () => ({
  runCombinedBackup: jest.fn().mockResolvedValue(undefined),
  initializeBackupDirectory: jest.fn().mockResolvedValue(undefined),
}));

import bookingsRouter from '../routes/bookingsRoutes';
import apartmentsRouter from '../routes/apartmentsRoutes';
import { prisma } from '../config/prisma';
import { appCache, CACHE_KEYS } from '../utils/cache';

const app = express();
app.use(express.json());
app.use('/api/bookings', bookingsRouter);
app.use('/api/apartments', apartmentsRouter);

let testApartmentId: string;
let testRateId: string;

const FUTURE_A_START = '2027-11-01T00:00:00.000Z';
const FUTURE_A_END = '2027-11-07T00:00:00.000Z';
const FUTURE_B_START = '2027-11-10T00:00:00.000Z';
const FUTURE_B_END = '2027-11-15T00:00:00.000Z';

beforeAll(async () => {
  await prisma.reservationRequest.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.apartmentRate.deleteMany({});
  await prisma.apartment.deleteMany({ where: { name: { startsWith: 'CACHE-TEST-' } } });

  const apt = await prisma.apartment.create({
    data: { name: 'CACHE-TEST-Apartman', description: 'Keš test apartman' },
  });
  testApartmentId = apt.id;

  const rate = await prisma.apartmentRate.create({
    data: {
      apartmentId: testApartmentId,
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-12-31T23:59:59.999Z'),
      price: 100.0,
      capacity: 2,
    },
  });
  testRateId = rate.id;
});

afterAll(async () => {
  await prisma.reservationRequest.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.apartmentRate.deleteMany({ where: { id: testRateId } });
  await prisma.apartment.deleteMany({ where: { name: { startsWith: 'CACHE-TEST-' } } });
  await prisma.$disconnect();
});

// Čistimo keš pre svakog testa da počnemo iz čistog stanja
beforeEach(() => {
  appCache.flushAll();
});

// =============================================================================
// §1 — PENDING_REQUESTS keš invalidacija posle approve
// =============================================================================

describe('Keš: PENDING_REQUESTS invalidacija posle approve', () => {
  it('C01 — GET /requests/pending puni keš, approve ga mora obrisati', async () => {
    // 1. Kreirati zahtev u bazi direktno (zaobilazimo PENDING_EMAIL fazu)
    const guestRequest = await prisma.reservationRequest.create({
      data: {
        apartmentId: testApartmentId,
        guest: 'Keš Test Gost',
        email: 'kas@example.com',
        phone: '',
        startDate: new Date(FUTURE_A_START),
        endDate: new Date(FUTURE_A_END),
        status: 'PENDING_APPROVAL',
        emailToken: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // 2. GET /requests/pending puni keš
    const firstFetch = await request(app).get('/api/bookings/requests/pending');
    expect(firstFetch.status).toBe(200);
    expect(firstFetch.body.length).toBeGreaterThanOrEqual(1);

    // 3. Verifikujemo da je keš popunjen
    const cachedBefore = appCache.get(CACHE_KEYS.PENDING_REQUESTS);
    expect(cachedBefore).toBeDefined();

    // 4. Admin odobrava zahtev
    const approveRes = await request(app).post('/api/bookings/requests/approve').send({
      requestId: guestRequest.id,
      capacity: 2,
      guest: guestRequest.guest,
      email: guestRequest.email,
      phone: guestRequest.phone,
    });
    expect(approveRes.status).toBe(201);

    // 5. KRITIČNA PROVERA: Keš mora biti obrisan posle approve
    // Ovaj test PADA u trenutnoj implementaciji — PENDING_REQUESTS se ne čisti!
    const cachedAfter = appCache.get(CACHE_KEYS.PENDING_REQUESTS);
    expect(cachedAfter).toBeUndefined();
  });

  it('C02 — GET /requests/pending posle approve prikazuje ažuriranu listu (bez odobrenog)', async () => {
    // Kreiramo drugi zahtev
    const req2 = await prisma.reservationRequest.create({
      data: {
        apartmentId: testApartmentId,
        guest: 'Drugi Keš Gost',
        email: 'kas2@example.com',
        phone: '',
        startDate: new Date(FUTURE_B_START),
        endDate: new Date(FUTURE_B_END),
        status: 'PENDING_APPROVAL',
        emailToken: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // Puni keš
    await request(app).get('/api/bookings/requests/pending');

    // Odobravamo
    await request(app).post('/api/bookings/requests/approve').send({
      requestId: req2.id,
      capacity: 2,
      guest: req2.guest,
      email: req2.email,
      phone: req2.phone,
    });

    // Sada GET treba da izvrši novi DB upit (ne iz keša) i ne prikazuje odobreni zahtev
    const freshFetch = await request(app).get('/api/bookings/requests/pending');
    expect(freshFetch.status).toBe(200);

    const approvedInList = freshFetch.body.find((r: any) => r.id === req2.id);
    expect(approvedInList).toBeUndefined();
  });

  it('C03 — Reject ispravno čisti keš (kontrolna provera — ovo već radi)', async () => {
    const req3 = await prisma.reservationRequest.create({
      data: {
        apartmentId: testApartmentId,
        guest: 'Reject Keš Gost',
        email: 'reject@example.com',
        phone: '',
        startDate: new Date('2027-12-01T00:00:00.000Z'),
        endDate: new Date('2027-12-05T00:00:00.000Z'),
        status: 'PENDING_APPROVAL',
        emailToken: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await request(app).get('/api/bookings/requests/pending');
    const cachedBefore = appCache.get(CACHE_KEYS.PENDING_REQUESTS);
    expect(cachedBefore).toBeDefined();

    await request(app).patch(`/api/bookings/requests/${req3.id}/reject`);

    const cachedAfter = appCache.get(CACHE_KEYS.PENDING_REQUESTS);
    expect(cachedAfter).toBeUndefined();
  });
});

// =============================================================================
// §2 — Booking keš invalidacija
// =============================================================================

describe('Keš: Booking invalidacija posle mutacija', () => {
  let createdBookingId: string;

  it('C04 — CREATE booking briše booking keš', async () => {
    // Ručno postavljamo keš
    appCache.set('bookings:2027-11:all:auth', { bookings: [], nextCursor: undefined });
    expect(appCache.get('bookings:2027-11:all:auth')).toBeDefined();

    const res = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Keš Brisanje Gost',
      email: 'kascreate@example.com',
      phone: '',
      startDate: '2027-11-20T00:00:00.000Z',
      endDate: '2027-11-25T00:00:00.000Z',
      capacity: 2,
    });
    expect(res.status).toBe(201);
    createdBookingId = res.body.booking.id;

    // Svi bookings: ključevi moraju biti obrisani
    const remainingKeys = appCache.keys().filter((k) => k.startsWith('bookings:'));
    expect(remainingKeys.length).toBe(0);
  });

  it('C05 — DELETE booking briše booking keš', async () => {
    appCache.set('bookings:2027-11:all:auth', { bookings: ['test'], nextCursor: undefined });

    const deleteRes = await request(app).delete(`/api/bookings/${createdBookingId}`);
    expect(deleteRes.status).toBe(200);

    const remainingKeys = appCache.keys().filter((k) => k.startsWith('bookings:'));
    expect(remainingKeys.length).toBe(0);
  });
});

// =============================================================================
// §3 — Apartment keš invalidacija
// =============================================================================

describe('Keš: Apartment invalidacija posle izmena', () => {
  it('C06 — DELETE sezonske stope briše apartment keš', async () => {
    // Puni apartment keš
    await request(app).get('/api/apartments');
    expect(appCache.get(CACHE_KEYS.APARTMENTS)).toBeDefined();

    // Brisanje stope treba invalidirati keš
    await request(app).delete(`/api/apartments/rates/${testRateId}`);

    // Keš treba biti obrisan
    expect(appCache.get(CACHE_KEYS.APARTMENTS)).toBeUndefined();
  });

  it('C07 — GET /api/apartments posle invalidacije radi novi DB upit', async () => {
    // Keš je prazan (iz prethodnog testa)
    expect(appCache.get(CACHE_KEYS.APARTMENTS)).toBeUndefined();

    const res = await request(app).get('/api/apartments');
    expect(res.status).toBe(200);
    expect(res.body.apartments).toBeDefined();

    // Sada treba biti popunjen ponovo
    expect(appCache.get(CACHE_KEYS.APARTMENTS)).toBeDefined();
  });
});
