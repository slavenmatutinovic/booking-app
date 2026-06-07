// =============================================================================
// 🧪 backend/src/tests/email-notifications.test.ts
// =============================================================================
//
// Testira da su sve email notifikacije pozvane u pravim trenucima.
//
// Pokretanje:
//   cd backend && npm test email-notifications
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';

jest.mock('../middleware/authMiddleware', () => ({
  requireAuth: (req: any, _r: any, next: any) => {
    req.user = { userId: 'a', role: 'ADMIN' };
    next();
  },
  requireAdmin: (_r: any, _s: any, next: any) => next(),
  optionalAuth: (req: any, _r: any, next: any) => {
    req.user = { userId: 'a', role: 'ADMIN' };
    next();
  },
}));

jest.mock('../cron/backupCreation', () => ({
  runCombinedBackup: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

const mockEmails = {
  sendBookingConfirmation: jest
    .fn<(payload: Record<string, unknown>) => Promise<void>>()
    .mockResolvedValue(undefined),
  sendBookingCancellation: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  sendBookingModification: jest
    .fn<(payload: Record<string, unknown>) => Promise<void>>()
    .mockResolvedValue(undefined),
  sendNewRequestToAdmin: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  sendRequestReceivedToGuest: jest
    .fn<(payload: Record<string, unknown>) => Promise<void>>()
    .mockResolvedValue(undefined),
  sendRequestRejectedToGuest: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
};

jest.mock('../utils/emailService', () => mockEmails);

import bookingsRouter from '../routes/bookingsRoutes';
import { prisma } from '../config/prisma';

const app = express();
app.use(express.json());
app.use('/api/bookings', bookingsRouter);

let aptId: string;

beforeAll(async () => {
  await prisma.reservationRequest.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.apartmentRate.deleteMany({});
  await prisma.apartment.deleteMany({ where: { name: { startsWith: 'EMAIL-TEST' } } });

  const apt = await prisma.apartment.create({ data: { name: 'EMAIL-TEST-Apt' } });
  aptId = apt.id;

  await prisma.apartmentRate.create({
    data: {
      apartmentId: aptId,
      startDate: new Date('2028-01-01'),
      endDate: new Date('2028-12-31'),
      price: 80,
      capacity: 2,
    },
  });
});

afterAll(async () => {
  await prisma.reservationRequest.deleteMany({});
  await prisma.booking.deleteMany({});
  await prisma.apartmentRate.deleteMany({});
  await prisma.apartment.deleteMany({ where: { name: { startsWith: 'EMAIL-TEST' } } });
  await prisma.$disconnect();
});

describe('📧 Email notifikacije', () => {
  it('E01 — sendRequestReceivedToGuest pozvan pri kreiranju zahteva', async () => {
    mockEmails.sendRequestReceivedToGuest.mockClear();

    const res = await request(app).post('/api/bookings/requests').send({
      apartmentId: aptId,
      guest: 'Email Tester',
      email: 'emailtest@example.com',
      startDate: '2028-06-01T00:00:00.000Z',
      endDate: '2028-06-05T00:00:00.000Z',
    });

    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 150));
    expect(mockEmails.sendRequestReceivedToGuest).toHaveBeenCalledTimes(1);
    expect(mockEmails.sendRequestReceivedToGuest).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'emailtest@example.com', guest: 'Email Tester' }),
    );
  });

  it('E02 — sendNewRequestToAdmin pozvan pri email verifikaciji', async () => {
    // Kreirati i verifikovati zahtev
    const req = await prisma.reservationRequest.create({
      data: {
        apartmentId: aptId,
        guest: 'Admin Notif Test',
        email: 'admin-notif@example.com',
        phone: '',
        startDate: new Date('2028-07-01'),
        endDate: new Date('2028-07-05'),
        status: 'PENDING_EMAIL',
        emailToken: 'email-notif-test-token',
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
    });

    mockEmails.sendNewRequestToAdmin.mockClear();

    const verifyRes = await request(app).get('/api/bookings/verify?token=email-notif-test-token');

    expect(verifyRes.status).toBe(200);
    await new Promise((r) => setTimeout(r, 150));
    expect(mockEmails.sendNewRequestToAdmin).toHaveBeenCalledTimes(1);
  });

  it('E03 — sendBookingConfirmation pozvan pri odobravanju zahteva', async () => {
    const pendingReq = await prisma.reservationRequest.create({
      data: {
        apartmentId: aptId,
        guest: 'Odobren Gost',
        email: 'approved@example.com',
        phone: '',
        startDate: new Date('2028-08-01'),
        endDate: new Date('2028-08-05'),
        status: 'PENDING_APPROVAL',
        emailToken: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    mockEmails.sendBookingConfirmation.mockClear();

    const approveRes = await request(app)
      .post('/api/bookings/requests/approve')
      .send({ requestId: pendingReq.id });

    expect(approveRes.status).toBe(201);
    await new Promise((r) => setTimeout(r, 150));
    expect(mockEmails.sendBookingConfirmation).toHaveBeenCalledTimes(1);
    expect(mockEmails.sendBookingConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CONFIRMED', email: 'approved@example.com' }),
    );
  });

  it('E04 — sendBookingCancellation pozvan pri soft-delete', async () => {
    const booking = await prisma.booking.create({
      data: {
        apartmentId: aptId,
        guest: 'Za Otkazivanje',
        email: 'cancel@example.com',
        phone: '',
        startDate: new Date('2028-09-01'),
        endDate: new Date('2028-09-05'),
        status: 'CONFIRMED',
        totalPrice: 320,
      },
    });

    mockEmails.sendBookingCancellation.mockClear();

    const deleteRes = await request(app).delete(`/api/bookings/${booking.id}`);
    expect(deleteRes.status).toBe(200);

    await new Promise((r) => setTimeout(r, 150));
    expect(mockEmails.sendBookingCancellation).toHaveBeenCalledTimes(1);
  });

  it('E05 — sendRequestRejectedToGuest pozvan pri odbijanju zahteva', async () => {
    const req = await prisma.reservationRequest.create({
      data: {
        apartmentId: aptId,
        guest: 'Odbijen Gost',
        email: 'rejected@example.com',
        phone: '',
        startDate: new Date('2028-10-01'),
        endDate: new Date('2028-10-05'),
        status: 'PENDING_APPROVAL',
        emailToken: null,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    mockEmails.sendRequestRejectedToGuest.mockClear();

    const rejectRes = await request(app).patch(`/api/bookings/requests/${req.id}/reject`);

    expect(rejectRes.status).toBe(200);
    await new Promise((r) => setTimeout(r, 150));
    expect(mockEmails.sendRequestRejectedToGuest).toHaveBeenCalledTimes(1);
  });
});
