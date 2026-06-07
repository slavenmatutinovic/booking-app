import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { createApartmentRateSchema } from '../validators/apartment.validator';
import { logger } from '../utils/logger';
import { appCache, CACHE_KEYS } from '../utils/cache';
import { Prisma } from '@prisma/client';

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
    // 🛡️ Prolazimo ceo req objekat kroz šemu
    const validation = createApartmentRateSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        message: 'Validaciona greška',
        errors: validation.error.format(),
      });
      return;
    }

    const { apartmentId, startDate, endDate, price, capacity } = validation.data.body;

    // 2. 🛡️ COLLISION INSPECTION LOOKUP:
    // Check if another configured rate block already maps over any slice of the chosen window
    const overlappingRate = await prisma.apartmentRate.findFirst({
      where: {
        apartmentId,
        // ✅ ISPRAVLJENO: Koristimo stroge operatore (lt/gt) umesto inkluzivnih (lte/gte).
        // Logika preklapanja glasi: (Postojeći_Start < Novi_End) AND (Postojeći_Kraj > Novi_Start).
        // Ovo sprečava lažne greške (konflikte) kada se sezone nadovezuju dan za danom.
        startDate: { lt: endDate },
        endDate: { gt: startDate },
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
        capacity,
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

    // 🛡️ Čišćenje keša nakon brisanja cene
    appCache.del(`apartment_rates:${apartmentId}`);
    appCache.del(CACHE_KEYS.APARTMENTS); // Čisti globalnu listu za kalendar
  } catch (error) {
    logger.error({ err: error }, '❌ Greška unutar createApartmentRate kontrolera');
    next(error);
  }
};

export const deleteApartmentRate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const id = String(req.params.id);

  if (!id || id === 'undefined') {
    res.status(400).json({ error: 'Nije prosleđen validan ID sezonske cene.' });
    return;
  }

  try {
    // 1. Pronađi zapis da uzmemo apartmentId pre nego što ga obrišemo
    const rate = await prisma.apartmentRate.findUnique({
      where: { id },
      select: { apartmentId: true },
    });

    if (!rate) {
      res.status(404).json({ error: 'Sezonska cena nije pronađena.' });
      return;
    }

    // 2. Trajno brisanje iz PostgreSQL baze
    await prisma.apartmentRate.delete({
      where: { id },
    });

    // 3. 🛡️ SELEKTIVNA INVALIDACIJA KEŠA: Izbacujemo snapshot tog apartmana iz RAM-a
    appCache.del(`apartment:${rate.apartmentId}`);
    // Takođe invalidiramo opštu listu apartmana za kalendar kako bi povukao sveže cene
    appCache.del(CACHE_KEYS.APARTMENTS);

    logger.info({ rateId: id, apartmentId: rate.apartmentId }, '🗑️ Sezonska cena uspešno obrisana');
    res.json({ message: 'Sezonska cena je uspešno obrisana.' });
  } catch (error) {
    logger.error({ err: error, rateId: id }, '❌ Greška unutar deleteApartmentRate kontrolera');
    next(error);
  }
};

export const updateApartmentRate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  // Sigurno kastujemo ID iz parametara i cenu iz body-ja nakon Zod validacije
  const id = String(req.params.id);
  const { price } = req.body;

  try {
    // 1. Ažuriramo cenu u bazi i odmah izvlačimo apartmentId za keš
    const updatedRate = await prisma.apartmentRate.update({
      where: { id },
      data: { price },
      select: {
        id: true,
        apartmentId: true,
        startDate: true,
        endDate: true,
        price: true,
        capacity: true,
      },
    });

    // 2. 🛡️ INVALIDACIJA KEŠA: Čistimo memoriju za taj apartman i globalnu listu
    appCache.del(`apartment:${updatedRate.apartmentId}`);
    appCache.del(CACHE_KEYS.APARTMENTS);

    logger.info(
      { rateId: id, apartmentId: updatedRate.apartmentId, newPrice: updatedRate.price },
      '✏️ Sezonska cena uspešno izmenjena',
    );

    res.json({
      message: 'Sezonska cena uspešno izmenjena.',
      rate: updatedRate,
    });
  } catch (error) {
    logger.error({ err: error, rateId: id }, '❌ Greška unutar updateApartmentRate kontrolera');

    // Ako zapis ne postoji u bazi (Prisma kod P2025)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      res.status(404).json({ error: 'Sezonska cena nije pronađena.' });
      return;
    }

    next(error);
  }
};

export const getApartmentRates = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const apartmentId = String(req.params.id);

  if (!apartmentId || apartmentId === 'undefined') {
    res.status(400).json({ error: 'Nije prosleđen validan ID apartmana.' });
    return;
  }

  try {
    // 1. Provera memorijskog keša za ovaj specifičan apartman
    const cacheKey = `apartment_rates:${apartmentId}`;
    const cachedRates = appCache.get(cacheKey);
    if (cachedRates) {
      res.json({ rates: cachedRates });
      return;
    }

    // 2. Provera da li apartman uopšte postoji i da nije soft-deleted
    const apartmentExists = await prisma.apartment.findFirst({
      where: { id: apartmentId, isDeleted: false },
    });

    if (!apartmentExists) {
      res.status(404).json({ error: 'Apartman nije pronađen ili je obrisan.' });
      return;
    }

    // 3. Povlačenje svih cena sortiranih hronološki po datumu početka
    const rates = await prisma.apartmentRate.findMany({
      where: { apartmentId },
      orderBy: { startDate: 'asc' },
      select: {
        id: true,
        apartmentId: true,
        startDate: true,
        endDate: true,
        price: true,
        capacity: true,
      },
    });

    // 4. Upis u keš na 1 sat (3600 sekundi)
    appCache.set(cacheKey, rates, 3600);

    logger.info(
      { apartmentId, count: rates.length },
      '🔍 getApartmentRates – cene uspešno učitane',
    );
    res.json({ rates });
  } catch (error) {
    logger.error({ err: error, apartmentId }, '❌ Greška unutar getApartmentRates kontrolera');
    next(error);
  }
};
