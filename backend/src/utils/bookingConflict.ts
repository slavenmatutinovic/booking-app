// backend/src/utils/bookingConflict.ts

import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

type PrismaTransaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function findConflictingBooking(
  tx: PrismaTransaction | typeof prisma,
  apartmentId: string,
  startDate: Date,
  endDate: Date,
  excludeBookingId?: string,
) {
  return tx.booking.findFirst({
    where: {
      apartmentId,
      status: 'CONFIRMED',
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      startDate: { lt: endDate },
      endDate: { gt: startDate },
    },
  });
}
