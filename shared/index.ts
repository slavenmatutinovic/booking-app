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
import { z } from 'zod';

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
  price: number;
  capacity: number;
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
  capacity: number;
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
  totalPrice?: number;
  capacity: number;
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

/**
 * Globalni strogi parser datuma — Single Source of Truth za celi monorepo.
 * Garantuje identičnu interpretaciju UTC ponoći bez ikakvih vremenskih pomaka.
 * Ako je unos prazan, lošeg formata ili kalendarski nepostojeći, odmah baca grešku.
 *
 * @param dateInput - String (YYYY-MM-DD ili ISO oblik) ili Date objekt
 * @throws Error - Ako datum nije kalendarski ispravan (Fail-Fast)
 */
export function parseUTCDate(dateInput: string | Date | undefined | null): Date {
  // 1. BARIJERA: Stroga zabrana praznih ili nedefinisanih unosa
  if (!dateInput) {
    throw new Error('DATE_PARSING_FAILED: Datum je obavezan i ne može biti prazan.');
  }

  // 2. BARIJERA: Ako je već prosleđen Date objekat, čistimo ga na UTC ponoć tog dana
  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) {
      throw new Error('DATE_PARSING_FAILED: Prosleđeni Date objekat je nevalidan.');
    }
    return new Date(
      Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()),
    );
  }

  // 3. IZDVAJANJE STRUNGA: Uzimamo samo YYYY-MM-DD deo (čak i ako stigne puni ISO string sa vremenom)
  const cleanStr = String(dateInput).split('T')[0] || '';
  const parts = cleanStr.split('-');

  // 4. BARIJERA STRUKTURE: Provera da li imamo tačno tri komponente (godina-mesec-dan)
  if (parts.length !== 3) {
    throw new Error(
      `DATE_PARSING_FAILED: Neispravan format [${dateInput}]. Očekuje se YYYY-MM-DD.`,
    );
  }

  // 5. DESTRUKTURIRANJE: Sigurno mapiranje u tuple (string trojac) koje uklanja 'undefined' upozorenje kompajlera
  const [yearStr, monthStr, dayStr] = parts as [string, string, string];

  // 6. KONVERZIJA: Stroga pretvorba pomoću Number() konstruktora (brže i rigoroznije od parseInt)
  const year = Number(yearStr);
  const month = Number(monthStr) - 1; // JS meseci unutar Date.UTC idu od 0 do 11
  const day = Number(dayStr);

  // 7. BARIJERA TIPA: Provera da li su sve komponente uspešno pretvorene u brojeve
  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    throw new Error(
      `DATE_PARSING_FAILED: Komponente datuma nisu validni brojevi za unos [${dateInput}].`,
    );
  }

  // Inicijalizujemo privremeni UTC datum
  const parsedDate = new Date(Date.UTC(year, month, day));

  // 8. LOGIČKA BARIJERA KALENDARA: Sprečava JavaScript da tiho "prelije" loš datum u sledeći mesec
  // (Npr. ako korisnik pošalje 31. april, JS bi to inače tiho pretvorio u 1. maj)
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month ||
    parsedDate.getUTCDate() !== day
  ) {
    throw new Error(`DATE_PARSING_FAILED: Datum [${dateInput}] kalendarski ne postoji.`);
  }

  // Vraćamo čist, stopostotno potvrđen UTC Date objekat postavljen na ponoć
  return parsedDate;
}

// 🎯 PREBAČENO U SHARED: Tvoj originalni strogi ISO 8601 UTC regex
export const isoDatetimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// Pomoćna funkcija za dobijanje početka današnjeg dana u UTC-u
export function getUTCStartOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}
