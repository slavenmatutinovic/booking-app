// =============================================================================
// 🏠 backend/src/routes/apartmentsRoutes.ts
// =============================================================================
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  RUTE ZA APARTMANE — Role-Based Access Control                          │
// │                                                                         │
// │  Apartmani su javni podaci — lista apartemana potrebna je kalendarу     │
// │  bez prijave. Upravljanje (kreiranje, izmjena, brisanje) zahtjeva admin.│
// └─────────────────────────────────────────────────────────────────────────┘
//
// 📋 TABELA PRISTUPA:
//
//   Method  │ Putanja              │ Ko može?
//   ────────┼──────────────────────┼────────────────────────────────────────
//   GET     │ /api/apartments      │ Svi (javno)
//   GET     │ /api/apartments/:id  │ Svi (javno)
//   POST    │ /api/apartments      │ Samo ADMIN
//   PATCH   │ /api/apartments/:id  │ Samo ADMIN
//   DELETE  │ /api/apartments/:id  │ Samo ADMIN
//
// =============================================================================
import { Router } from 'express';
import {
  getApartments,
  getApartmentById,
  createApartment,
  updateApartment,
  deleteApartment,
} from '../controllers/apartments.controller';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validateMiddleware';
import {
  createApartmentSchema,
  updateApartmentSchema,
  createApartmentRateSchema,
  updateApartmentRateSchema,
} from '../validators/apartment.validator';
import {
  createApartmentRate,
  deleteApartmentRate,
  getApartmentRates,
  updateApartmentRate,
} from '../controllers/rates.controller';

const router = Router();

// =============================================================================
// 🌍 JAVNE RUTE
// =============================================================================

/**
 * GET /api/apartments
 *
 * Lista svih apartmana za prikaz u sidebar-u kalendara.
 * Javno dostupno — neophodan podaci za javni pregled kalendara.
 *
 * Response: [{ id, name }]
 */
router.get('/', getApartments);

/**
 * GET /api/apartments/:id
 *
 * Detalji jednog apartmana sa pripadajućim aktivnim rezervacijama.
 * Javno dostupno — koristiti za detaljan pregled apartmana.
 */
router.get('/:id', getApartmentById);
// =============================================================================
// 🔑 ADMIN-ONLY RUTE
// =============================================================================

/**
 * POST /api/apartments
 * Kreiranje novog apartmana u sistemu.
 * Body: { name: string, description?: string }
 */
router.post('/', requireAuth, requireAdmin, validateBody(createApartmentSchema), createApartment);

// =============================================================================
// 💰 RUTE ZA SEZONSKE CENE (Unutar /api/apartments)
// =============================================================================

/**
 * GET /api/apartments/:id/rates
 * Čita sve sezonske cene za specifičan apartman
 */
router.get('/:id/rates', requireAuth, requireAdmin, getApartmentRates);

/**
 * POST /api/apartments/rates
 * ✅ Kreiranje nove sezonske cene sa Zod v4 validacijom tela (body)
 */
router.post(
  '/rates',
  requireAuth,
  requireAdmin,
  validateBody(createApartmentRateSchema), // Validira i body i capacity!
  createApartmentRate,
);

/**
 * DELETE /api/apartments/rates/:id
 * Trajno brisanje jedne sezonske cene
 */
router.delete('/rates/:id', requireAuth, requireAdmin, deleteApartmentRate);

/**
 * PATCH /api/apartments/rates/:id
 * Izmena cene unutar postojećeg sezonskog bloka
 */
router.patch(
  '/rates/:id',
  requireAuth,
  requireAdmin,
  validateBody(updateApartmentRateSchema),
  updateApartmentRate,
);

// =============================================================================
// 🏢 RUTE ZA UPRAVLJANJE APARTMANIMA (Unutar /api/apartments)
// =============================================================================

/**
 * PATCH /api/apartments/:id
 * Izmena naziva ili opisa apartmana.
 * Body: Parcijalni objekat — samo polja koja se mjenjaju
 */
router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  validateBody(updateApartmentSchema),
  updateApartment,
);

/**
 * DELETE /api/apartments/:id
 * Trajno brisanje apartmana.
 * ⚠️  Blokira se na beku ako apartman ima aktivne rezervacije.
 *     Otkazati sve rezervacije prije brisanja apartmana.
 */
router.delete('/:id', requireAuth, requireAdmin, deleteApartment);

export default router;
