// =============================================================================
// 🗺️  backend/src/routes/bookingsRoutes.ts
// =============================================================================
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  RUTE ZA REZERVACIJE — Role-Based Access Control                        │
// │                                                                         │
// │  Implementira trostepeni sistem pristupa:                               │
// │                                                                         │
// │  🌍 Javno (bez prijave):                                                │
// │     GET /api/bookings — Vraća datume popunjenosti (bez detalja gostiju)  │
// │                                                                         │
// │  👁️  Viewer (prijavljen):                                                │
// │     GET /api/bookings — Vraća sve detalje (ime, email, telefon)         │
// │                                                                         │
// │  🔑 Admin (prijavljen + ADMIN rola):                                    │
// │     POST   /api/bookings        — Direktno kreiranje rezervacije        │
// │     PATCH  /api/bookings/:id    — Izmena datuma i detalja               │
// │     DELETE /api/bookings/:id    — Otkazivanje (soft delete)             │
// └─────────────────────────────────────────────────────────────────────────┘
//
// 📋 KOMPLETNA TABELA PRISTUPA:
//
//   Method  │ Putanja            │ Ko može?
//   ────────┼────────────────────┼─────────────────────────────────────────
//   GET     │ /api/bookings      │ Svi (gost vidi samo datume)
//   POST    │ /api/bookings      │ Samo ADMIN (direktna rezervacija)
//   PATCH   │ /api/bookings/:id  │ Samo ADMIN (izmena)
//   DELETE  │ /api/bookings/:id  │ Samo ADMIN (soft delete → CANCELLED)
//
//   POST    │ /api/booking-requests     │ Javno (gost šalje zahtev, bez prijave)
//   GET     │ /api/booking-requests/pending │ ADMIN vidi sve zahteve
//   GET     │ /api/booking-requests/count   │ ADMIN vidi broj zahteva za badge
//   POST    │ /api/booking-requests/approve │ ADMIN odobrava zahtev (kreira rezervaciju)
//   PATCH   │ /api/booking-requests/:id/reject │ ADMIN odbija zahtev (menja status)
//
//   Napomene:
//   - POST /api/bookings je strogo za ADMINA i koristi se samo za direktno kreiranje rezervacija.
//     Gosti koji šalju zahteve koriste POST /api/booking-requests, koji je javno dostupan.
//   - Odobravanje zahteva (approve) se obavlja kroz posebnu rutu koja uključuje transakciju i provjeru konflikta.
//   - Odbijanje zahteva (reject) menja status u bazi i obaveštava gosta, ali ne briše zahtev (ostaje u istoriji).
//   - Ove rute zahtevaju novu tabelu u bazi (booking_requests) i odgovarajuće modele i migracije.
//   - Implementacija: backend/src/controllers/guestRequests.controller.ts i backend/src/controllers/adminRequests.controller.ts
//
// =============================================================================
//
// 🗺️  backend/src/controllers/adminRequests.controller.ts
//   GET     │ /api/booking-requests     │ ADMIN vidi sve zahtjeve
//   POST    │ /api/booking-requests     │ Viewer/Gost šalje zahtev
//   PATCH   │ /api/booking-requests/:id │ ADMIN odobrava/odbija
//
//   Ovo zahtjeva novu tabelu u bazi, novi kontroler i migraciju.
//   Vidi: backend/src/controllers/bookingRequests.controller.ts (TODO)
//
// =============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { updateBooking, deleteBooking } from '../controllers/bookings.controller';
import { getBookings } from '../controllers/getBookings.controller';
import { createBooking } from '../controllers/createBooking.controller';
import {
  mutationRateLimiter,
  standaloneRequestsLimiter,
} from '../middleware/rateLimiterMiddleware';
import {
  createBookingRequest,
  verifyReservationEmail,
} from '../controllers/guestRequests.controller';
import {
  getPendingRequestsCount,
  getPendingRequests,
  rejectRequest,
} from '../controllers/adminRequests.controller';

import { optionalAuth, requireAuth, requireAdmin } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validateMiddleware';
import {
  createBookingSchema,
  createGuestRequestSchema,
  updateBookingSchema,
} from '../../../shared/validators';
import { validateConditionalCreate } from '../validators/booking.validator';

const router = Router();

// =============================================================================
// 🌍 JAVNE RUTE (bez obavezne prijave)
// =============================================================================

/**
 * GET /api/bookings
 *
 * Javno dostupna ruta — prikazuje popunjenost kalendara svima.
 * optionalAuth popunjava req.user ako postoji validan token, ali ne blokira.
 *
 * Kontroler (getBookings) čita req.user?.role i odlučuje što vraća:
 *   • ADMIN/VIEWER → Svi podaci (guest, email, phone)
 *   • undefined   → Samo {id, apartmentId, startDate, endDate, color}
 *                   (bez imena gosta — privatnost)
 *
 * Query parametri:
 *   ?month=2026-06        → Filtriranje po mesecu (preporučeno za performanse)
 *   ?apartmentId=<id>     → Filtriranje po apartmanu
 */
router.get('/', optionalAuth, getBookings);

// Public verification callback link clicks
router.get('/verify', verifyReservationEmail);

// Ova ruta je 100% javna — omogućava neulogovanim gostima da pošalju zahtev

router.post(
  '/requests',
  optionalAuth,
  standaloneRequestsLimiter,
  validateBody(createGuestRequestSchema),
  createBookingRequest,
);

// =============================================================================
// 📬 🔑 AKCIJE ZA UPRAVLJANJE ZAHTEVIMA GOSTIJU (Strogo za ADMINA)
// =============================================================================

/**
 * GET /api/bookings/requests/pending
 * Admin povlači tabelu zahteva koji čekaju odobrenje
 */
router.get('/requests/pending', requireAuth, requireAdmin, getPendingRequests);

router.get('/requests/count', requireAuth, requireAdmin, getPendingRequestsCount);

/**
 * POST /api/bookings/requests/approve
 * Admin odobrava zahtev (šalje requestId u body, aktivira pametni kontroler)
 */
router.post(
  '/requests/approve',
  requireAuth,
  requireAdmin,
  mutationRateLimiter, // 🎯 Štiti bazu od brzih uzastopnih odobrenja (spamming klikova)
  validateConditionalCreate,
  createBooking,
);

/**
 * PATCH /api/bookings/requests/:id/reject
 * Admin odbija zahtev gosta (menja status u bazi)
 */
router.patch(
  '/requests/:id/reject',
  requireAuth,
  requireAdmin,
  mutationRateLimiter, // 🎯 Identitetski-svestan rate limit za odbijanje
  rejectRequest,
);

// =============================================================================
// 🔑 ADMIN-ONLY RUTE (obavezna prijava + ADMIN rola)
// =============================================================================

/**
 * POST /api/bookings
 *
 * Direktno kreiranje potvrđene rezervacije.
 * Samo admin može direktno kreirati — gosti/vieweri šalju booking-requests.
 *
 * Body: { apartmentId, guest, startDate, endDate, email?, phone? }
 */
router.post(
  '/',
  requireAuth,
  requireAdmin,
  mutationRateLimiter, // 🎯 Prati rad admina po njegovom userId, ne po IP adresi
  validateConditionalCreate,
  createBooking,
);

/**
 * PATCH /api/bookings/:id
 *
 * Izmena postojeće rezervacije (datumi, detalji gosta, status).
 * Koristi se i za drag&drop pomeranje (samo startDate + endDate).
 *
 * Body: Parcijalni objekat — samo polja koja se mijenjaju
 */
router.patch(
  '/:id',
  requireAuth,
  requireAdmin,
  mutationRateLimiter,
  validateBody(updateBookingSchema),
  updateBooking,
);

/**
 * DELETE /api/bookings/:id
 *
 * Soft delete — ne briše iz baze, mijenja status u CANCELLED.
 * Prednosti soft delete-a:
 *   • Istorija rezervacija ostaje sačuvana za izvještaje
 *   • Mogućnost oporavka obrisane rezervacije
 *   • Nema problema sa stranim ključevima
 */
router.delete('/:id', requireAuth, requireAdmin, mutationRateLimiter, deleteBooking);

export default router;
