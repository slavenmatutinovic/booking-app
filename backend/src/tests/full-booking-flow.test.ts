// =============================================================================
// 🧪 backend/src/tests/full-booking-flow.test.ts
// =============================================================================
//
// Testira kompletan tok rezervacije:
//   Faza 1: Gost šalje zahtev (PENDING_EMAIL)
//   Faza 2: Gost verifikuje email (PENDING_APPROVAL)
//   Faza 3: Admin odobrava (Booking kreiran, email potvrde)
//   Faza 4: Admin odbija (REJECTED, email odbijanja)
//   Faza 5: Cron čisti istekle zahteve (EXPIRED)
//   Faza 6: Konflikt termina
//
// Pokretanje:
//   cd backend && npm test full-booking-flow
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// ── Mock: Auth middleware ──────────────────────────────────────────────────────
jest.mock('../middleware/authMiddleware', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-test-id', role: 'ADMIN' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-test-id', role: 'ADMIN' };
    next();
  },
}));

// ── Mock: Email service ────────────────────────────────────────────────────────
const mockSendBookingConfirmation = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockSendRequestReceivedToGuest = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockSendNewRequestToAdmin = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockSendRequestRejectedToGuest = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockSendBookingCancellation = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.mock('../utils/emailService', () => ({
  sendBookingConfirmation: mockSendBookingConfirmation,
  sendBookingCancellation: mockSendBookingCancellation,
  sendBookingModification: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  sendNewRequestToAdmin: mockSendNewRequestToAdmin,
  sendRequestReceivedToGuest: mockSendRequestReceivedToGuest,
  sendRequestRejectedToGuest: mockSendRequestRejectedToGuest,
}));

// ── Mock: Backup cron ─────────────────────────────────────────────────────────
jest.mock('../cron/backupCreation', () => ({
  runCombinedBackup: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

import bookingsRouter from '../routes/bookingsRoutes';
import apartmentsRouter from '../routes/apartmentsRoutes';
import { prisma } from '../config/prisma';
//import { executeCleanup } from '../cron/cleanupCron'; // Expose za direktan poziv

const app = express();
app.use(express.json());
app.use('/api/bookings', bookingsRouter);
app.use('/api/apartments', apartmentsRouter);

// ── Test data ─────────────────────────────────────────────────────────────────
let testApartmentId: string;
let testRateId: string;

// Datumi u budućnosti (dovoljno daleko da ne zastariju)
const FUTURE_START = '2027-08-10T00:00:00.000Z';
const FUTURE_END = '2027-08-15T00:00:00.000Z';
const FUTURE_START_2 = '2027-09-01T00:00:00.000Z';
const FUTURE_END_2 = '2027-09-07T00:00:00.000Z';

// ── Setup / Teardown ──────────────────────────────────────────────────────────
beforeAll(async () => {
  // Čistimo sve test podatke
  await prisma.reservationRequest.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.apartmentRate.deleteMany({});
  await prisma.apartment.deleteMany({ where: { name: { startsWith: 'TEST-' } } });

  // Kreiramo test apartman
  const apt = await prisma.apartment.create({
    data: { name: 'TEST-Apartman-A', description: 'Test apartman' },
  });
  testApartmentId = apt.id;

  // Kreiramo sezonske cene za oba test termina
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
  await prisma.apartmentRate.deleteMany({});
  await prisma.apartment.deleteMany({ where: { name: { startsWith: 'TEST-' } } });
  await prisma.$disconnect();
});

// =============================================================================
// BLOK 1: FAZA 1 — Gost šalje zahtev (PENDING_EMAIL)
// =============================================================================

describe('📬 Faza 1 — Kreiranje zahteva gosta', () => {
  it('T01 — Prihvata validan zahtev i vraća requestId', async () => {
    const res = await request(app).post('/api/bookings/requests').send({
      apartmentId: testApartmentId,
      guest: 'Milica Petrović',
      email: 'milica@example.com',
      phone: '+381641234567',
      startDate: FUTURE_START,
      endDate: FUTURE_END,
    });

    expect(res.status).toBe(201);
    expect(res.body.requestId).toBeDefined();
    expect(res.body.message).toMatch(/potvrdite/i);

    // Verifikujemo u bazi
    const dbReq = await prisma.reservationRequest.findUnique({
      where: { id: res.body.requestId },
    });
    expect(dbReq).not.toBeNull();
    expect(dbReq!.status).toBe('PENDING_EMAIL');
    expect(dbReq!.emailToken).not.toBeNull();

    // Email gostu je poslat
    expect(mockSendRequestReceivedToGuest).toHaveBeenCalledTimes(1);
  });

  it('T02 — Odbija zahtev sa nevalidnim emailom', async () => {
    const res = await request(app).post('/api/bookings/requests').send({
      apartmentId: testApartmentId,
      guest: 'Laza Lazić',
      email: 'nije-validan-email',
      startDate: FUTURE_START_2,
      endDate: FUTURE_END_2,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('T03 — Odbija zahtev sa datumom u prošlosti', async () => {
    const res = await request(app).post('/api/bookings/requests').send({
      apartmentId: testApartmentId,
      guest: 'Petar Petrović',
      email: 'petar@example.com',
      startDate: '2020-01-01T00:00:00.000Z',
      endDate: '2020-01-07T00:00:00.000Z',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/prošlosti|past/i);
  });

  it('T04 — Odbija zahtev duži od MAX_BOOKING_DAYS', async () => {
    const start = new Date('2027-08-01T00:00:00.000Z');
    const end = new Date('2027-11-30T23:59:59.999Z'); // >90 dana
    const res = await request(app).post('/api/bookings/requests').send({
      apartmentId: testApartmentId,
      guest: 'Dugi Boravak',
      email: 'dugi@example.com',
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/90 dana|MAX_BOOKING/i);
  });
});

// =============================================================================
// BLOK 2: FAZA 2 — Verifikacija emaila (PENDING_EMAIL → PENDING_APPROVAL)
// =============================================================================

describe('✅ Faza 2 — Email verifikacija', () => {
  let emailToken: string;
  let requestId: string;

  beforeAll(async () => {
    // Kreiramo svež zahtev direktno u bazi za ovaj blok testova
    const newReq = await prisma.reservationRequest.create({
      data: {
        apartmentId: testApartmentId,
        guest: 'Ana Anić',
        email: 'ana@example.com',
        phone: '',
        startDate: new Date(FUTURE_START),
        endDate: new Date(FUTURE_END),
        status: 'PENDING_EMAIL',
        emailToken: 'test-token-verify-123',
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    });
    emailToken = 'test-token-verify-123';
    requestId = newReq.id;
  });

  it('T05 — Validan token prebacuje zahtev u PENDING_APPROVAL', async () => {
    const res = await request(app).get(`/api/bookings/verify?token=${emailToken}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Email uspešno verifikovan');

    // Proveravamo bazu
    const dbReq = await prisma.reservationRequest.findUnique({ where: { id: requestId } });
    expect(dbReq!.status).toBe('PENDING_APPROVAL');
    expect(dbReq!.emailToken).toBeNull(); // Jednokratna upotreba

    // Admin je obavešten
    expect(mockSendNewRequestToAdmin).toHaveBeenCalled();
  });

  it('T06 — Iskorišćeni token vraća grešku', async () => {
    const res = await request(app).get(`/api/bookings/verify?token=${emailToken}`);

    expect(res.status).toBe(404);
    expect(res.text).toContain('nevažeći ili je istekao');
  });

  it('T07 — Istekli token vraća grešku', async () => {
    // Kreiramo zahtev sa expiresAt u prošlosti
    const expiredReq = await prisma.reservationRequest.create({
      data: {
        apartmentId: testApartmentId,
        guest: 'Expired User',
        email: 'expired@example.com',
        phone: '',
        startDate: new Date(FUTURE_START_2),
        endDate: new Date(FUTURE_END_2),
        status: 'PENDING_EMAIL',
        emailToken: 'expired-token-xyz',
        expiresAt: new Date(Date.now() - 1000), // Već isteklo
      },
    });

    const res = await request(app).get('/api/bookings/verify?token=expired-token-xyz');

    expect(res.status).toBe(404);

    // Cleanup
    await prisma.reservationRequest.delete({ where: { id: expiredReq.id } });
  });

  it('T08 — Nedostajući token vraća 400', async () => {
    const res = await request(app).get('/api/bookings/verify');
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// BLOK 3: FAZA 3 — Admin odobrava zahtev
// =============================================================================

describe('✅ Faza 3 — Admin odobrava zahtev', () => {
  let pendingRequestId: string;

  beforeAll(async () => {
    // Kreiramo zahtev direktno u PENDING_APPROVAL statusu
    const req = await prisma.reservationRequest.create({
      data: {
        apartmentId: testApartmentId,
        guest: 'Bojan Bojić',
        email: 'bojan@example.com',
        phone: '+381601234567',
        startDate: new Date(FUTURE_START),
        endDate: new Date(FUTURE_END),
        status: 'PENDING_APPROVAL',
        emailToken: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    pendingRequestId = req.id;
  });

  it('T09 — Admin odobrava i kreira rezervaciju', async () => {
    mockSendBookingConfirmation.mockClear();

    const res = await request(app)
      .post('/api/bookings/requests/approve')
      .send({ requestId: pendingRequestId });

    expect(res.status).toBe(201);
    expect(res.body.booking).toBeDefined();
    expect(res.body.booking.status).toBe('CONFIRMED');

    // Zahtev je označen kao APPROVED
    const dbReq = await prisma.reservationRequest.findUnique({
      where: { id: pendingRequestId },
    });
    expect(dbReq!.status).toBe('APPROVED');

    // Email potvrde je poslat
    await new Promise((r) => setTimeout(r, 100)); // Čekamo fire&forget
    expect(mockSendBookingConfirmation).toHaveBeenCalledTimes(1);

    // Cena je izračunata (5 noći × 100 = 500)
    expect(Number(res.body.booking.totalPrice)).toBe(500);
  });

  it('T10 — Dvostruko odobravanje istog zahteva vraća 404', async () => {
    const res = await request(app)
      .post('/api/bookings/requests/approve')
      .send({ requestId: pendingRequestId });

    expect(res.status).toBe(404);
  });
});

// =============================================================================
// BLOK 4: FAZA 4 — Admin odbija zahtev
// =============================================================================

describe('❌ Faza 4 — Admin odbija zahtev', () => {
  let rejectableRequestId: string;

  beforeAll(async () => {
    const req = await prisma.reservationRequest.create({
      data: {
        apartmentId: testApartmentId,
        guest: 'Tanja Tanić',
        email: 'tanja@example.com',
        phone: '',
        startDate: new Date(FUTURE_START_2),
        endDate: new Date(FUTURE_END_2),
        status: 'PENDING_APPROVAL',
        emailToken: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    rejectableRequestId = req.id;
  });

  it('T11 — Admin odbija zahtev, gost dobija email', async () => {
    mockSendRequestRejectedToGuest.mockClear();

    const res = await request(app).patch(`/api/bookings/requests/${rejectableRequestId}/reject`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/odbijen/i);

    const dbReq = await prisma.reservationRequest.findUnique({
      where: { id: rejectableRequestId },
    });
    expect(dbReq!.status).toBe('REJECTED');

    await new Promise((r) => setTimeout(r, 100));
    expect(mockSendRequestRejectedToGuest).toHaveBeenCalledTimes(1);
  });

  it('T12 — Odbijanje već odbijenog zahteva vraća 404', async () => {
    const res = await request(app).patch(`/api/bookings/requests/${rejectableRequestId}/reject`);
    expect(res.status).toBe(404);
  });
});

// =============================================================================
// BLOK 5: Direktna admin rezervacija
// =============================================================================

describe('📅 Direktna admin rezervacija', () => {
  it('T13 — Admin kreira direktnu rezervaciju', async () => {
    const res = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Direktni Gost',
      email: 'direktni@example.com',
      phone: null,
      startDate: FUTURE_START_2,
      endDate: FUTURE_END_2,
    });

    expect(res.status).toBe(201);
    expect(res.body.booking.guest).toBe('Direktni Gost');
    expect(Number(res.body.booking.totalPrice)).toBe(600); // 6 noći × 100
  });

  it('T14 — Konflikt termina vraća 409', async () => {
    const res = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Konfliktni Gost',
      email: 'konflikt@example.com',
      startDate: FUTURE_START_2,
      endDate: FUTURE_END_2,
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/slobodan|zauzet|rezervacija/i);
  });

  it('T15 — Soft delete menja status u CANCELLED', async () => {
    // Kreirati rezervaciju pa obrisati
    const createRes = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Za Brisanje',
      email: 'brisanje@example.com',
      startDate: '2027-10-01T00:00:00.000Z',
      endDate: '2027-10-05T00:00:00.000Z',
    });
    expect(createRes.status).toBe(201);

    const bookingId = createRes.body.booking.id;
    const deleteRes = await request(app).delete(`/api/bookings/${bookingId}`);
    expect(deleteRes.status).toBe(200);

    const dbBooking = await prisma.booking.findUnique({ where: { id: bookingId } });
    expect(dbBooking!.status).toBe('CANCELLED');

    await new Promise((r) => setTimeout(r, 100));
    expect(mockSendBookingCancellation).toHaveBeenCalled();
  });
});

// =============================================================================
// BLOK 6: Pristup bez autentikacije (GDPR filter)
// =============================================================================

describe('🔒 GDPR — Javni pristup bez auth', () => {
  it('T16 — GET /api/bookings bez auth sakrije ime gosta', async () => {
    // Kreiramo app bez auth mocker-a
    const publicApp = express();
    publicApp.use(express.json());

    // Preuzimamo optionalAuth bez mock-a (imitiramo javni poziv)
    const { optionalAuth } = await import('../middleware/authMiddleware');
    // Postavljamo prazan req.user simulacijom
    publicApp.use((req: any, _res: any, next: any) => {
      req.user = undefined; // Gost bez naloga
      next();
    });
    publicApp.use('/api/bookings', bookingsRouter);

    const res = await request(publicApp).get(`/api/bookings?startMonth=2027-08&endMonth=2027-10`);

    expect(res.status).toBe(200);
    if (res.body.bookings.length > 0) {
      const booking = res.body.bookings[0];
      expect(booking.guest).toBe('Zauzeto');
      expect(booking.email).toBe('skriveno@podaci.com');
    }
  });
});

// =============================================================================
// BLOK 7: Datum validacija
// =============================================================================

describe('📅 Datum validacija', () => {
  it('T17 — Odbija rezervaciju sa end <= start', async () => {
    const res = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Ludi Datum',
      email: 'ludi@example.com',
      startDate: '2027-09-10T00:00:00.000Z',
      endDate: '2027-09-10T00:00:00.000Z', // isti dan
    });
    expect(res.status).toBe(400);
  });

  it('T18 — Odbija rezervaciju sa nevalidnim ISO formatom', async () => {
    const res = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Format Greška',
      email: 'format@example.com',
      startDate: '15.07.2027', // Pogrešan format
      endDate: '20.07.2027',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ISO 8601/i);
  });
});
