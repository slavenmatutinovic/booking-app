import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';

// 1. MOCK AUTH MIDDLEWARE (Mora biti iznad uvoza rutera da bi se presreo requireAuth)
jest.mock('../middleware/authMiddleware', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    // Simuliramo da je korisnik uspešno autentifikovan
    req.user = { userId: 'test-admin-id', role: 'ADMIN' };
    next();
  },
  requireAdmin: (req: any, _res: any, next: any) => {
    // Simuliramo da korisnik ima admin privilegije
    next();
  },
}));

// Sada bezbedno uvozimo rutere koji će pokupiti naš lažni (mock) auth sistem
import bookingsRouter from '../routes/bookingsRoutes';
import apartmentsRouter from '../routes/apartmentsRoutes';
import { prisma } from '../config/prisma';

const app = express();
app.use(express.json());

app.use('/api/bookings', bookingsRouter);
app.use('/api/apartments', apartmentsRouter);

describe('🛑 Bookings API - Integracioni i Konkurentni Testovi', () => {
  let testApartmentId: string;

  beforeAll(async () => {
    await prisma.booking.deleteMany({});
    await prisma.apartment.deleteMany({});

    const apartment = await prisma.apartment.create({
      data: {
        name: 'Test Apartman Lux',
        description: 'Prelep apartman za testiranje performansi',
      },
    });
    testApartmentId = apartment.id;
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({});
    await prisma.apartment.deleteMany({});
    await prisma.$disconnect();
  });

  // ─── TEST 1: ZOD VALIDACIJA DATUMA ───
  it('should reject booking if dates are in the wrong chronological order', async () => {
    const res = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Nikola Tesla',
      startDate: '2026-07-10T00:00:00.000Z',
      endDate: '2026-07-05T00:00:00.000Z',
    });

    expect(res.status).toBe(400);
  });

  // ─── TEST 2: OSNOVNI KONFLIKT TERMINA ───
  it('should create a booking and reject a subsequent overlapping booking', async () => {
    const firstRes = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Marko Marković',
      startDate: '2026-06-01T00:00:00.000Z',
      endDate: '2026-06-05T00:00:00.000Z',
    });

    expect(firstRes.status).toBe(201);

    const duplicateRes = await request(app).post('/api/bookings').send({
      apartmentId: testApartmentId,
      guest: 'Petar Petrović',
      startDate: '2026-06-03T00:00:00.000Z',
      endDate: '2026-06-07T00:00:00.000Z',
    });

    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.error).toContain('Termin nije slobodan');
  });

  // ─── TEST 3: TRKA ZA RESURSE (RACE CONDITION) ───
  it('should prevent race conditions when two users book the exact same slot simultaneously', async () => {
    const payload1 = {
      apartmentId: testApartmentId,
      guest: 'Konkurentni Kupac A',
      startDate: '2026-08-15T00:00:00.000Z',
      endDate: '2026-08-20T00:00:00.000Z',
    };

    const payload2 = {
      apartmentId: testApartmentId,
      guest: 'Konkurentni Kupac B',
      startDate: '2026-08-15T00:00:00.000Z',
      endDate: '2026-08-20T00:00:00.000Z',
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
        startDate: new Date('2026-08-15T00:00:00.000Z'),
      },
    });
    expect(databaseCount).toBe(1);
  });
});
