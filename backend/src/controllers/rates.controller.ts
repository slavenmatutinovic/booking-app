import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { createApartmentRateSchema } from '../validators/rate.validator';
import { logger } from '../utils/logger';
import { appCache } from '../utils/cache';

/**
 * 💰 POST /api/apartments/rates
 * Svrha: Definiše novi sezonski cenovnik za apartman sa proverom preklapanja opsega.
 */
export const createApartmentRate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  logger.info({ adminId: req.user?.userId }, '💰 Pokušaj unosa novog sezonskog cenovnika');

  try {
    // 1. Validate raw incoming payload metrics using Zod
    const validation = createApartmentRateSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        message: 'Validaciona greška',
        errors: validation.error.format(),
      });
      return;
    }

    const { apartmentId, startDate, endDate, price } = validation.data;

    // 2. 🛡️ COLLISION INSPECTION LOOKUP:
    // Check if another configured rate block already maps over any slice of the chosen window
    const overlappingRate = await prisma.apartmentRate.findFirst({
      where: {
        apartmentId,
        // Strict interval overlapping logic condition formula: (StartA < EndB) AND (EndA > StartB)
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    });

    if (overlappingRate) {
      const existingStart = overlappingRate.startDate.toISOString().split('T')[0];
      const existingEnd = overlappingRate.endDate.toISOString().split('T')[0];

      res.status(409).json({
        error: `Izabrani period se preklapa sa već postojećim cenovnikom [${existingStart} do ${existingEnd}] koji iznosi ${overlappingRate.price}€.`,
      });
      return;
    }

    // 3. Persist the clean new rate interval matrix directly into PostgreSQL
    const newRate = await prisma.apartmentRate.create({
      data: {
        apartmentId,
        startDate,
        endDate,
        price,
      },
    });

    // 🧹 FLUSH SYSTEM CACHES:
    // Because single apartment views cache booking and pricing details for 30 minutes,
    // we drop the cached snapshot to make sure the new pricing matrix takes effect instantly.
    appCache.del(`apartment:${apartmentId}`);
    logger.info({ rateId: newRate.id, apartmentId }, '✅ Sezonski cenovnik uspešno sačuvan');

    res.status(201).json({
      message: 'Sezonski cenovnik uspešno kreiran.',
      rate: newRate,
    });
  } catch (error) {
    logger.error({ err: error }, '❌ Greška unutar createApartmentRate kontrolera');
    next(error);
  }
};
