// =============================================================================
// 📦 shared/types/index.ts
// =============================================================================
//
// ZAJEDNIČKI TIPOVI — Koriste i frontend i backend.
//
// Ovo je jedina istina (single source of truth) za sve interfejse koji
// opisuju domenske entitete. Importuj odavde umesto da definišeš lokalno.
//
// Frontend:  import { Booking, Apartment, ... } from '../../shared/types'
// Backend:   import { BookingStatus, UserRole, ... } from '../../shared/types'
//
// Pravilo: Ako tip opisuje domenski entitet (Booking, Apartment, User) —
//          ide ovde. Ako je čisto UI state (DraggingState, SelectionState) —
//          ostaje u frontend/src/types/ui.ts
// =============================================================================

// =============================================================================
// §1  🔐 AUTENTIKACIJA I ROLE
// =============================================================================

export type UserRole = 'ADMIN' | 'VIEWER';

export type BookingStatus = 'CONFIRMED' | 'CANCELLED';

export type RequestStatus =
  | 'PENDING_EMAIL'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED';

/**
 * Minimalni podaci o prijavljenom korisniku.
 * Ne sadrži lozinku niti tokenVersion — ti podaci ostaju na beku.
 */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface ApartmentRateData {
  id: string;
  apartmentId: string;
  startDate: string;
  endDate: string;
  price: string | number;
}

// =============================================================================
// §2  🏠 APARTMANI
// =============================================================================

export interface Apartment {
  id: string;
  name: string;
  description?: string;
  rates?: ApartmentRateData[];
}

// =============================================================================
// §3  📅 REZERVACIJE
// =============================================================================

/**
 * Rezervacija kako je vraća API.
 * startDate/endDate su ISO 8601 stringovi.
 *
 * Frontend konvertuje u FrontendBooking (yyyy-MM-dd) pre prikaza.
 */
export interface ApiBooking {
  id: string;
  apartmentId: string;
  guest: string;
  email: string;
  phone?: string | null;
  /** ISO 8601: "2026-06-15T00:00:00.000Z" */
  startDate: string;
  /** ISO 8601: "2026-06-20T00:00:00.000Z" */
  endDate: string;
  status: BookingStatus;
  totalPrice: number;
  apartment?: { id: string; name: string };
}

/**
 * Payload za kreiranje rezervacije (POST /api/bookings).
 * Koriste i frontend (pri slanju) i backend (pri validaciji tipova).
 */
export interface CreateBookingPayload {
  apartmentId: string;
  guest: string;
  email: string;
  phone?: string | null;
  /** ISO 8601 string ili Date objekat */
  startDate: string;
  endDate: string;
  totalPrice: number;
}

/**
 * Payload za izmenu rezervacije (PATCH /api/bookings/:id).
 */
export interface UpdateBookingPayload {
  guest?: string;
  email?: string;
  phone?: string | null;
  startDate?: string | Date;
  endDate?: string | Date;
  status?: BookingStatus;
  totalPrice?: number;
}

// =============================================================================
// §4  📬 ZAHTEVI ZA REZERVACIJU (ReservationRequest)
// =============================================================================

/**
 * Zahtev gosta/viewera koji čeka admin odobrenje.
 * Razlikuje se od Booking-a — ne kreira se direktno u Booking tabeli.
 */
export interface ReservationRequest {
  id: string;
  apartmentId: string;
  guest: string;
  email: string;
  phone?: string | null;
  startDate: string;
  endDate: string;
  status: RequestStatus;
  expiresAt: string;
  createdAt: string;
  apartment?: { id: string; name: string };
}

export interface CreateRequestPayload {
  apartmentId: string;
  guest: string;
  email: string;
  phone?: string | null;
  startDate: string | Date;
  endDate: string | Date;
}

// =============================================================================
// §5  📊 API ODGOVORI (Response shape)
// =============================================================================

/** Standardni odgovor greškom sa beka */
export interface ApiError {
  error: string;
}

/** Odgovor za GET /api/bookings sa paginacijom */
export interface BookingsResponse {
  bookings: ApiBooking[];
  nextCursor?: string;
}

// =============================================================================
// §6  🎨 KONSTANTE
// =============================================================================

/**
 * Paleta boja za booking barove.
 * Dodjeljuje se ciklično: PALETTE[index % PALETTE.length].
 */
export const PALETTE: string[] = [
  '#4f46e5', // Indigo
  '#0f766e', // Teal
  '#9333ea', // Ljubičasta
  '#c2410c', // Narandžasta
  '#0369a1', // Plava
  '#15803d', // Zelena
  '#b45309', // Žuta-smeđa
  '#be185d', // Roza
];

/** Maksimalan broj dana u jednoj rezervaciji */
export const MAX_BOOKING_DAYS = 90;
