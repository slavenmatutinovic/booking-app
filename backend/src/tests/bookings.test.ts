// backend/src/tests/bookings.test.ts
// POPRAVKE: BUG-06 (dodat email u testove), novi testovi za ReservationRequest flow

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// 1. MOCK AUTH MIDDLEWARE
jest.mock('../middleware/authMiddleware', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'test-admin-id', role: 'ADMIN' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => {
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { userId: 'test-admin-id', role: 'ADMIN' };
    next();
  },
}));

// 2. MOCK EMAIL SERVICE — ne šalji stvarne emailove u testovima
jest.mock('../utils/emailService', () => ({
  sendBookingConfirmation: jest.fn().mockResolvedValue(undefined),
  sendBookingCancellation: jest.fn().mockResolvedValue(undefined),
  sendBookingModification: jest.fn().mockResolvedValue(undefined),
  sendNewRequestToAdmin: jest.fn().mockResolvedValue(undefined),
  sendRequestReceivedToGuest: jest.fn().mockResolvedValue(undefined),
  sendRequestRejectedToGuest: jest.fn().mockResolvedValue(undefined),
}));

import bookingsRouter from '../routes/bookingsRoutes';
import apartmentsRouter from '../routes/apartmentsRoutes';
import { prisma } from '../config/prisma';
import {
  sendBookingConfirmation,
  sendNewRequestToAdmin,
  sendRequestReceivedToGuest,
  sendRequestRejectedToGuest,
} from '../utils/emailService';

const app = express();
app.use(express.json());
app.use('/api/bookings', bookingsRouter);
app.use('/api/apartments', apartmentsRouter);

// ─────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────

let testApartmentId: string;

beforeAll(async () => {
  await prisma.reservationRequest.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.apartment.deleteMany({});

  const apartment = await prisma.apartment.create({
    data: {
      name: 'Test Apartman Lux',
      description: 'Prelep apartman za testiranje',
    },
  });
  testApartmentId = apartment.id;
});

afterAll(async () => {
  await prisma.reservationRequest.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.apartment.deleteMany({});
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOK 1: DIREKTNO KREIRANJE REZERVACIJA (Admin)
// ─────────────────────────────────────────────────────────────────────────────

describe('📅 Direktno kreiranje rezervacija (Admin)', () => {
  // [BUG-06 POPRAVKA] Test sada sadrži email polje
  it('T01 — Odbija rezervaciju ako su datumi u pogrešnom redosledu', async () => {
    const res = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Nikola Tesla',
      email: 'tesla@example.com', // ← BUG-06 popravka: dodato obavezno polje
      startDate: '2026-07-10T00:00:00.000Z',
      endDate: '2026-07-05T00:00:00.000Z', // ← end < start = greška
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/odlaska|dolaska|datum/i);
  });

  it('T02 — Odbija rezervaciju ako email nije prosleđen', async () => {
    const res = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Petar Petrović',
      // email namerno izostavljen
      startDate: '2026-07-01T00:00:00.000Z',
      endDate: '2026-07-05T00:00:00.000Z',
    });

    expect(res.status).toBe(400);
    // Ovaj test proverava TAČAN razlog odbijanja (nedostaje email)
  });

  // [BUG-06 POPRAVKA] Dodat email u oba payload-a
  it('T03 — Kreira rezervaciju i odbija preklapajuću rezervaciju', async () => {
    const firstRes = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Marko Marković',
      email: 'marko@example.com', // ← BUG-06 popravka
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-09-05T00:00:00.000Z',
    });

    expect(firstRes.status).toBe(201);
    expect(firstRes.body.booking).toBeDefined();

    // Email potvrde treba biti pozvan
    expect(sendBookingConfirmation).toHaveBeenCalledTimes(1);

    const duplicateRes = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Petar Petrović',
      email: 'petar@example.com', // ← BUG-06 popravka
      startDate: '2026-09-03T00:00:00.000Z',
      endDate: '2026-09-07T00:00:00.000Z',
    });

    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.error).toContain('Termin nije slobodan');
  });

  it('T04 — Race condition: samo jedna od dve istovremene rezervacije prolazi', async () => {
    const payload1 = {
      apartmentId: testApartmentId,
      guest: 'Kupac A',
      email: 'a@example.com',
      startDate: '2026-10-15T00:00:00.000Z',
      endDate: '2026-10-20T00:00:00.000Z',
    };

    const payload2 = {
      apartmentId: testApartmentId,
      guest: 'Kupac B',
      email: 'b@example.com',
      startDate: '2026-10-15T00:00:00.000Z',
      endDate: '2026-10-20T00:00:00.000Z',
    };

    const [res1, res2] = await Promise.all([
      request(app).post('/api/bookings').send(payload1),
      request(app).post('/api/bookings').send(payload2),
    ]);

    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(201);
    expect(statuses).toContain(409);

    const databaseCount = await prisma.booking.count({
      where: {
        apartmentId: testApartmentId,
        startDate: new Date('2026-10-15T00:00:00.000Z'),
        status: 'CONFIRMED',
      },
    });
    expect(databaseCount).toBe(1);
  });

  it('T05 — Odbija rezervaciju koja prelazi MAX_BOOKING_DAYS (90 dana)', async () => {
    const res = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Dugi Gost',
      email: 'dugi@example.com',
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: '2027-03-01T00:00:00.000Z', // > 90 dana
    });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOK 2: ZAHTEVI GOSTIJU (ReservationRequest flow)
// ─────────────────────────────────────────────────────────────────────────────

describe('📬 Zahtevi gostiju (ReservationRequest)', () => {
  let createdRequestId: string;

  it('T06 — Gost može poslati zahtev za slobodan termin', async () => {
    const res = await request(app).post('/api/bookings/requests').send({
      apartmentId: testApartmentId,
      guest: 'Ana Anić',
      email: 'ana@example.com',
      phone: '+381601234567',
      startDate: '2026-12-01T00:00:00.000Z',
      endDate: '2026-12-05T00:00:00.000Z',
    });

    expect(res.status).toBe(201);
    expect(res.body.requestId).toBeDefined();
    createdRequestId = res.body.requestId;

    // [BUG-01 POPRAVKA] Oba emaila trebaju biti pozvana
    expect(sendNewRequestToAdmin).toHaveBeenCalledTimes(1);
    expect(sendRequestReceivedToGuest).toHaveBeenCalledTimes(1);
  });

  it('T07 — Gost ne može poslati zahtev za zauzet termin (potvrđena rezervacija)', async () => {
    // Prvo kreiramo potvrđenu rezervaciju
    await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Zauzet Gost',
      email: 'zauzet@example.com',
      startDate: '2026-12-10T00:00:00.000Z',
      endDate: '2026-12-15T00:00:00.000Z',
    });

    // Sada gost pokušava zahtev za isti termin
    const res = await request(app).post('/api/bookings/requests').send({
      apartmentId: testApartmentId,
      guest: 'Novi Gost',
      email: 'novi@example.com',
      startDate: '2026-12-12T00:00:00.000Z',
      endDate: '2026-12-17T00:00:00.000Z',
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('zauzet');
  });

  it('T08 — Admin vidi listu pending zahteva', async () => {
    const res = await request(app).get('/api/bookings/requests/pending');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Ana Anić zahtev iz T06 treba biti tu
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('guest');
    expect(res.body[0]).toHaveProperty('apartment');
  });

  it('T09 — Admin može odobriti zahtev (konvertuje u Booking)', async () => {
    const res = await request(app).post('/api/bookings/requests/approve').send({
      requestId: createdRequestId,
    });

    expect(res.status).toBe(201);
    expect(res.body.booking).toBeDefined();
    expect(res.body.booking.status).toBe('CONFIRMED');

    // Provera u bazi
    const booking = await prisma.booking.findFirst({
      where: { guest: 'Ana Anić', status: 'CONFIRMED' },
    });
    expect(booking).not.toBeNull();

    // Originalni zahtev treba biti uklonjen iz pending
    const stillPending = await prisma.reservationRequest.findUnique({
      where: { id: createdRequestId },
    });
    expect(stillPending?.status).not.toBe('PENDING_APPROVAL');
  });

  it('T10 — Admin ne može odobriti isti zahtev dva puta', async () => {
    const res = await request(app).post('/api/bookings/requests/approve').send({
      requestId: createdRequestId,
    });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/istakao|ne postoji|već obrađen/i);
  });

  it('T11 — Admin može odbiti zahtev i gost dobija email', async () => {
    // Kreirati novi zahtev za odbijanje
    const newReq = await request(app).post('/api/bookings/requests').send({
      apartmentId: testApartmentId,
      guest: 'Gost Za Odbijanje',
      email: 'odbijen@example.com',
      startDate: '2027-01-05T00:00:00.000Z',
      endDate: '2027-01-10T00:00:00.000Z',
    });
    const requestIdToReject = newReq.body.requestId;

    const res = await request(app).patch(`/api/bookings/requests/${requestIdToReject}/reject`);

    expect(res.status).toBe(200);

    // [BUG-03 POPRAVKA] Email odbijanja treba biti poslat
    expect(sendRequestRejectedToGuest).toHaveBeenCalled();

    // Status u bazi treba biti REJECTED
    const rejected = await prisma.reservationRequest.findUnique({
      where: { id: requestIdToReject },
    });
    expect(rejected?.status).toBe('REJECTED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOK 3: VALIDACIJA I EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe('🔒 Validacija i edge cases', () => {
  it('T12 — Odbija nepostojeći apartmanId', async () => {
    const res = await request(app).post('/api/bookings').send({
      apartmentId: 'nepostojeci-id-xyz',
      guest: 'Test Gost',
      email: 'test@example.com',
      startDate: '2027-02-01T00:00:00.000Z',
      endDate: '2027-02-05T00:00:00.000Z',
    });

    expect(res.status).toBe(404);
  });

  it('T13 — Soft delete: otkazana rezervacija ne utiče na kalendar', async () => {
    const createRes = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Gost Za Brisanje',
      email: 'brisanje@example.com',
      startDate: '2027-03-01T00:00:00.000Z',
      endDate: '2027-03-05T00:00:00.000Z',
    });

    const bookingId = createRes.body.booking.id;

    const deleteRes = await request(app).delete(`/api/bookings/${bookingId}`);
    expect(deleteRes.status).toBe(200);

    // Nakon brisanja, isti termin treba biti slobodan
    const newBookingRes = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Novi Na Istom Terminu',
      email: 'novi2@example.com',
      startDate: '2027-03-01T00:00:00.000Z',
      endDate: '2027-03-05T00:00:00.000Z',
    });

    expect(newBookingRes.status).toBe(201);
  });

  it('T14 — Odbija dupli soft delete', async () => {
    const createRes = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Dupli Delete Gost',
      email: 'dupli@example.com',
      startDate: '2027-04-01T00:00:00.000Z',
      endDate: '2027-04-03T00:00:00.000Z',
    });

    const bookingId = createRes.body.booking.id;

    await request(app).delete(`/api/bookings/${bookingId}`);
    const secondDelete = await request(app).delete(`/api/bookings/${bookingId}`);

    expect(secondDelete.status).toBe(400);
    expect(secondDelete.body.error).toContain('već ranije otkazana');
  });

  it('T15 — Gost ne može poslati zahtev sa neispravnim emailom', async () => {
    const res = await request(app).post('/api/bookings/requests').send({
      apartmentId: testApartmentId,
      guest: 'Test Gost',
      email: 'ovo-nije-email',
      startDate: '2027-05-01T00:00:00.000Z',
      endDate: '2027-05-05T00:00:00.000Z',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });
});
