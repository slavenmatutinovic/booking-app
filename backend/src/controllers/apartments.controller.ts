// =============================================================================
// 🏠 backend/src/controllers/apartments.controller.ts
// =============================================================================
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  CRUD ZA APARTMANE                                                      │
// │                                                                         │
// │  Pristup po rolama:                                                     │
// │    🌍 Javno:  GET /api/apartments, GET /api/apartments/:id              │
// │    🔑 Admin:  POST, PATCH, DELETE                                       │
// └─────────────────────────────────────────────────────────────────────────┘
//
// 📋 PREGLED KONTROLERA:
//
//   getApartments    → Lista svih apartmana (za kalendar sidebar)
//   getApartmentById → Jedan apartman sa rezervacijama (za detaljan prikaz)
//   createApartment  → Admin kreira novi apartman
//   updateApartment  → Admin menja naziv ili opis
//   deleteApartment  → Admin briše apartman (blokira se ako ima aktivnih rezervacija)
//
// ⚡ PERFORMANSE:
//
//   GET /api/apartments je dobar kandidat za cache.
//   Lista apartmana se ne menja često (admin je rijetko menja).
//   Preporučuje se node-cache ili Redis sa TTL od 5-30 minuta.
//   Invalidirati cache pri svakom POST/PATCH/DELETE pozivu.
//
// 🔒 BEZBEDNOST:
//
//   Sve admin rute su zaštićene u apartmentsRoutes.ts:
//     router.post('/', requireAuth, requireAdmin, createApartment);
//   Ovaj kontroler ne treba ponovo proveravati role.
//
// =============================================================================

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';
import { Prisma } from '@prisma/client';
import { createApartmentSchema, updateApartmentSchema } from '../validators/apartment.validator';
import { appCache, CACHE_KEYS, invalidateApartmentCache } from '../utils/cache';

// Tip za raw SQL upit — Prisma ne može zaključati specifičan red kroz ORM sintaksu
type ApartmentRow = { id: string };

// =============================================================================
// 🌍 GET /api/apartments
// =============================================================================

/**
 * Vraća listu svih apartmana sortirano po imenu.
 *
 * Javno dostupno — nema autentikacije.
 * Koristi se pri inicijalizaciji kalendara (CalendarSidebar).
 *
 * Response: { apartments: [{ id, name, description }] }
 */
export const getApartments = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  logger.debug({ userId: req.user?.userId }, '🏠 GET /api/apartments');

  try {
    // 1. Proveri keš
    const cached = appCache.get(CACHE_KEYS.APARTMENTS);
    if (cached) {
      // UVEK VRAĆAMO ENKAPSULIRAN OBJEKAT ZAŠTITE RADI KOMPATIBILNOSTI SA FRONTENDOM
      res.json({ apartments: cached }); // ✅ VRAĆA ČIST NIZ (Usklađeno sa frontendom)
      return;
    }

    // 2. Ako nema u kešu, čitaj iz baze
    const apartments = await prisma.apartment.findMany({
      where: {
        isDeleted: false, // Soft-delete safe guard filter
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        rates: {
          select: {
            id: true,
            apartmentId: true,
            startDate: true,
            endDate: true,
            price: true,
            capacity: true,
          },
          orderBy: { startDate: 'asc' },
        },
      },
    });

    // 3. Upis u keš na 1 sat (3600 sekundi)

    appCache.set(CACHE_KEYS.APARTMENTS, apartments, 3600);
    logger.info({ count: apartments.length }, '✅ getApartments — učitano');

    res.json({ apartments });
  } catch (error) {
    logger.error({ err: error }, '❌ getApartments — greška u bazi');

    next(error);
  }
};

// =============================================================================
// 🌍 GET /api/apartments/:id
// =============================================================================

/**
 * Vraća detalje jednog apartmana sa listom aktivnih rezervacija.
 *
 * Javno dostupno — korisno za modalni prikaz detalja apartmana.
 * Filtrira samo CONFIRMED rezervacije (CANCELLED se ne prikazuju).
 *
 * Response: { apartment: { id, name, description, bookings: [...] } }
 */
export const getApartmentById = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { id } = req.params;
  logger.debug(
    { apartmentId: id, userRole: req.user?.role || 'ANONYMOUS' },
    '🏢 GET /api/apartments/:id — Dohvatanje apartmana sa proverom privatnosti',
  );

  // Prisma parametri su uvek array u Express route handler-ima — uzimamo prvi
  const safeId = Array.isArray(id) ? id[0] : id;

  if (!safeId) {
    res.status(400).json({ error: 'ID apartmana je obavezan.' });
    return;
  }

  // ⚡ Jedinstveni ključ za keširanje ovog specifičnog apartmana sa svim sirovim podacima
  const cacheKey = `apartment:${safeId}`;

  try {
    // 🔍 KORAK 1: Pokušaj čitanja iz brze memorije (Cache HIT)
    let apartment = appCache.get<any>(cacheKey);

    if (!apartment) {
      // 💾 KORAK 2: Cache MISS — Idemo u bazu podataka po sirove (nesanitizovane) podatke
      // Povlačimo i 'guest' polje kako bi ga keš sačuvao za admina, a filtriraćemo ga naknadno dole
      apartment = await prisma.apartment.findUnique({
        where: { id: safeId },
        select: {
          id: true,
          name: true,
          description: true,
          bookings: {
            where: { status: 'CONFIRMED' }, // Ne vraćamo otkazane rezervacije
            orderBy: { startDate: 'asc' },
            select: {
              id: true,
              startDate: true,
              endDate: true,
              guest: true, // Povlačimo u keš, ali maskiramo pre slanja javnim korisnicima
            },
          },
        },
      });

      if (!apartment) {
        res.status(404).json({ error: 'Apartman nije pronađen.' });
        return;
      }

      // Upisujemo pun, originalan objekat iz baze u keš na 30 minuta (1800s)
      appCache.set(cacheKey, apartment, 1800);
      logger.debug({ cacheKey }, '💾 Cache MISS — Podaci o apartmanu uspešno keširani');
    } else {
      logger.debug({ cacheKey }, '⚡ Cache HIT — Vraćam podatke o apartmanu iz memorije');
    }

    // 🛡️ KORAK 3: Read the active user permissions from optionalAuth middleware properties
    const userRole = req.user?.role; // e.g., 'ADMIN', 'VIEWER', or undefined
    const hasPrivilegedAccess = userRole === 'ADMIN' || userRole === 'VIEWER';

    // Pravimo plitku kopiju keširanog objekta da ne bismo slučajno izmenili sam keš u memoriji servera
    const apartmentResponse = {
      ...apartment,
      bookings: [...apartment.bookings],
    };

    // 🔒 KORAK 4: If the user is unauthenticated, mask all private data before sending
    if (!hasPrivilegedAccess) {
      const sanitizedBookings = apartmentResponse.bookings.map((b: any) => ({
        id: b.id,
        apartmentId: safeId,
        startDate: b.startDate,
        endDate: b.endDate,
        color: '#3b82f6', // Dodajemo boju za frontend (nije privatna informacija)
        // 🔒 GDPR Enforcement: Confidential properties are explicitly omitted
        guest: 'Zauzeto',
        email: null,
        phone: null,
      }));

      // Override the original array structure with the clean data footprint
      apartmentResponse.bookings = sanitizedBookings;
    }

    logger.info({ apartmentId: safeId }, '✅ getApartmentById — pronađen i isporučen');

    // Vraćamo tačan format koji tvoj frontend kalendar očekuje: { apartment: { ... } }
    res.json({ apartment: apartmentResponse });
  } catch (error) {
    logger.error({ err: error, apartmentId: safeId }, '❌ getApartmentById — greška u bazi');

    next(error);
  }
};

// =============================================================================
// 🔑 POST /api/apartments
// =============================================================================

/**
 * Kreira novi apartman u sistemu.
 *
 * Samo admin može kreirati — zaštita je u ruti (requireAuth + requireAdmin).
 * Validacija: Zod šema u apartment.validator.ts.
 *
 * Body: { name: string, description?: string }
 * Response: 201 Created + { message, apartment }
 */
export const createApartment = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  logger.debug({ body: req.body, userId: req.user?.userId }, '🏠 POST /api/apartments');

  const parseResult = createApartmentSchema.safeParse(req.body);
  if (!parseResult.success) {
    const firstError = parseResult.error.issues[0]?.message ?? 'Neispravan unos';
    logger.warn({ errors: parseResult.error.issues }, '⚠️ createApartment — validacija neuspešna');
    res.status(400).json({ error: firstError });
    return;
  }

  const { name, description } = parseResult.data;

  try {
    const apartment = await prisma.apartment.create({
      data: { name: name.trim(), description: description?.trim() ?? '' },
      select: { id: true, name: true, description: true },
    });

    logger.info({ apartmentId: apartment.id, name }, '✅ Apartman kreiran');
    res.status(201).json({ message: 'Apartman je uspešno kreiran', apartment });

    // INVALIDACIJA KEŠA — briše se stari niz, novi će se učitati pri sledećem GET pozivu
    appCache.del(CACHE_KEYS.APARTMENTS);
  } catch (error) {
    // Prisma P2002 = unique constraint violation — ime apartmana je zauzeto
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      logger.warn({ name }, '⚠️ createApartment — naziv već postoji');
      res.status(409).json({ error: `Apartman sa nazivom "${name}" već postoji.` });
      return;
    }
    logger.error({ err: error }, '❌ createApartment — greška u bazi');
    next(error);
  }
};

// =============================================================================
// 🔑 PATCH /api/apartments/:id
// =============================================================================

/**
 * Menja naziv ili opis apartmana.
 *
 * Parcijalan update — možeš poslati samo `name` ili samo `description`.
 * Body: { name?: string, description?: string }
 * Response: { message, apartment }
 */
export const updateApartment = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { id } = req.params;
  logger.debug(
    { apartmentId: id, body: req.body, userId: req.user?.userId },
    '✏️ PATCH /api/apartments/:id',
  );

  const safeId = Array.isArray(id) ? id[0] : id;
  if (!safeId) {
    res.status(400).json({ error: 'ID apartmana je obavezan.' });
    return;
  }

  const parseResult = updateApartmentSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.issues[0]?.message ?? 'Neispravan unos' });
    return;
  }

  try {
    // 🚀 REŠENJE: Filtriramo sve ključeve koji imaju vrednost 'undefined'
    // da bismo zadovoljili restrikciju 'exactOptionalPropertyTypes: true'
    const updateData = Object.fromEntries(
      Object.entries(parseResult.data).filter(([_, v]) => v !== undefined),
    );

    const apartment = await prisma.apartment.update({
      where: { id: safeId },
      data: updateData,
      select: { id: true, name: true, description: true },
    });

    logger.info({ apartmentId: safeId }, '✅ Apartman ažuriran');
    res.json({ message: 'Apartman je uspešno ažuriran', apartment });

    // INVALIDACIJA KEŠA — briše se stari niz, novi će se učitati pri sledećem GET pozivu
    invalidateApartmentCache(safeId);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      res.status(404).json({ error: 'Apartman nije pronađen.' });
      return;
    }
    logger.error({ err: error }, '❌ updateApartment — greška u bazi');
    next(error);
  }
};

// =============================================================================
// 🔑 DELETE /api/apartments/:id
// =============================================================================

/**
 * Briše apartman iz sistema.
 *
 * ⚠️  UPOZORENJE: Brisanje je TRAJNO (hard delete).
 *     Blokira se ako apartman ima aktivne (CONFIRMED) rezervacije.
 *     Najbezbednije je prvo otkazati sve rezervacije, pa tek onda brisati apartman.
 *
 * Razlog za blokiranje: Stranim ključevima u Booking tabeli bi ostali "orphan" redovi
 * što bi narušilo integritet baze. Prisma to sprečava (P2003 greška).
 *
 * Response: { message }
 */
export const deleteApartment = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const { id } = req.params;
  logger.debug({ apartmentId: id, userId: req.user?.userId }, '🗑️ DELETE /api/apartments/:id');

  const safeId = Array.isArray(id) ? id[0] : id;
  if (!safeId) {
    res.status(400).json({ error: 'ID apartmana je obavezan.' });
    return;
  }

  try {
    await prisma.apartment.update({
      where: { id: safeId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });

    logger.info({ apartmentId: safeId, adminId: req.user?.userId }, '✅ Apartman obrisan');
    res.json({ message: 'Apartman je uspešno obrisan.' });
    // INVALIDACIJA KEŠA — briše se stari niz, novi će se učitati pri sledećem GET pozivu
    invalidateApartmentCache(safeId);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        res.status(404).json({ error: 'Apartman nije pronađen.' });
        return;
      }
      // P2003 = foreign key constraint — apartman ima rezervacije
      if (error.code === 'P2003') {
        logger.warn(
          { apartmentId: safeId },
          '⚠️ deleteApartment — apartman ima aktivne rezervacije',
        );
        res.status(409).json({
          error:
            'Nije moguće obrisati apartman koji ima rezervacije. Prvo otkažite sve rezervacije.',
        });
        return;
      }
    }
    logger.error({ err: error }, '❌ deleteApartment — greška u bazi');
    next(error);
  }
};
