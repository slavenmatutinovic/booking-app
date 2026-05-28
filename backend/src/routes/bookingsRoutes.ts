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
// 🔮 BUDUĆE PROŠIRENJE — Zahtjevi za rezervaciju (booking requests):
//
//   GET     │ /api/booking-requests     │ ADMIN vidi sve zahtjeve
//   POST    │ /api/booking-requests     │ Viewer/Gost šalje zahtev
//   PATCH   │ /api/booking-requests/:id │ ADMIN odobrava/odbija
//
//   Ovo zahtjeva novu tabelu u bazi, novi kontroler i migraciju.
//   Vidi: backend/src/controllers/bookingRequests.controller.ts (TODO)
//
// =============================================================================

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  getBookings,
  createBooking,
  updateBooking,
  deleteBooking,
} from '../controllers/bookings.controller';
import {
  createBookingRequest,
  getPendingRequests,
  rejectRequest,
  getPendingRequestsCount,
} from '../controllers/bookingRequests.controller';
import { optionalAuth, requireAuth, requireAdmin } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validateMiddleware';
import {
  createBookingSchema,
  createGuestRequestSchema,
  updateBookingSchema,
} from '../validators/booking.validator';

// 🛡️ DECOUPLED LIMITER: Declared inside this context to break circular dependency paths
const standaloneRequestsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window profiles
  max: 30, // Limit each client IP to 30 booking requests per cycle
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Previše poslatih zahteva. Pokušajte ponovo za 15 minuta.' },
});

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

// Ova ruta je 100% javna — omogućava neulogovanim gostima da pošalju zahtev

router.post(
  '/requests',
  standaloneRequestsLimiter,
  validateBody(createGuestRequestSchema),
  createBookingRequest,
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
router.post('/', requireAuth, requireAdmin, validateBody(createBookingSchema), createBooking);

/**
 * PATCH /api/bookings/:id
 *
 * Izmena postojeće rezervacije (datumi, detalji gosta, status).
 * Koristi se i za drag&drop pomeranje (samo startDate + endDate).
 *
 * Body: Parcijalni objekat — samo polja koja se mijenjaju
 */
router.patch('/:id', requireAuth, requireAdmin, validateBody(updateBookingSchema), updateBooking);

/**
 * DELETE /api/bookings/:id
 *
 * Soft delete — ne briše iz baze, mijenja status u CANCELLED.
 * Prednosti soft delete-a:
 *   • Istorija rezervacija ostaje sačuvana za izvještaje
 *   • Mogućnost oporavka obrisane rezervacije
 *   • Nema problema sa stranim ključevima
 */
router.delete('/:id', requireAuth, requireAdmin, deleteBooking);

// =============================================================================
// 📬 🔑 AKCIJE ZA UPRAVLJANJE ZAHTEVIMA GOSTIJU (Strogo za ADMINA)
// =============================================================================

/**
 * GET /api/bookings/requests/pending
 * Admin povlači tabelu zahteva koji čekaju odobrenje
 */
router.get('/requests/pending', requireAuth, requireAdmin, getPendingRequests);

/**
 * POST /api/bookings/requests/approve
 * Admin odobrava zahtev (šalje requestId u body, aktivira pametni kontroler)
 */
router.post(
  '/requests/approve',
  requireAuth,
  requireAdmin,
  validateBody(createBookingSchema),
  createBooking,
);

/**
 * PATCH /api/bookings/requests/:id/reject
 * Admin odbija zahtev gosta (menja status u bazi)
 */
router.patch('/requests/:id/reject', requireAuth, requireAdmin, rejectRequest);

router.get('/requests/count', requireAuth, requireAdmin, getPendingRequestsCount);

export default router;
