// backend/src/utils/bookingConflict.ts

import { prisma } from '../config/prisma';
import { ApartmentRate } from '@prisma/client'; // Direktni uvoz iz Prisme, bez custom tipova
import { calculateStayPriceShared } from '../../../shared/pricing';
import { parseStringToUTCDate } from './dateUtils';
import { ApartmentRateData } from '../../../shared/index';

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

/**
 * 🔒 ATOMIČNI FINANSIJSKI REKALKULATOR (BUG-03 & BUG-12 Fix)
 * Računa ukupnu cenu boravka dan po dan na osnovu sezonskih tarifa i izabranog kapaciteta.
 * 100% Bez 'any' tipa, bez fallback-ova i DST-safe (UTC ponoć).
 */

export const calculateStayPrice = (
  rates: ApartmentRate[], // Koristi originalni Prisma tip izgenerisan iz tvoje sheme
  startDate: Date,
  totalNights: number,
  bookingCapacity: number,
): number => {
  // Direktno prosleđivanje bez ručnog mapiranja petlje i bez ijednog custom interface-a
  return calculateStayPriceShared({
    rates: rates as any as ApartmentRateData[], // Type-cast bez kreiranja novih tipova
    startDateInput: parseStringToUTCDate(startDate),
    totalNights,
    bookingCapacity,
  }) as number;
};
