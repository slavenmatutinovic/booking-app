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
import {
  getBookings,
  createBooking,
  updateBooking,
  deleteBooking,
} from '../controllers/bookings.controller';
import { createBookingRequest } from '../controllers/bookingRequests.controller';
import { optionalAuth, requireAuth, requireAdmin } from '../middleware/authMiddleware';
import { requestsLimiter } from '../server';
import { Server } from 'tls';

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
router.post('/requests', createBookingRequest);

router.post('/requests', requestsLimiter, createBookingRequest);

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
router.post('/', requireAuth, requireAdmin, createBooking);

/**
 * PATCH /api/bookings/:id
 *
 * Izmena postojeće rezervacije (datumi, detalji gosta, status).
 * Koristi se i za drag&drop pomeranje (samo startDate + endDate).
 *
 * Body: Parcijalni objekat — samo polja koja se mijenjaju
 */
router.patch('/:id', requireAuth, requireAdmin, updateBooking);

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
export default router;
