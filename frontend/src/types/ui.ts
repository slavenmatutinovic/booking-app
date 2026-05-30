// =============================================================================
// 📦 frontend/src/types/ui.ts
// =============================================================================
//
// FRONTEND-ONLY TIPOVI — Čisto UI state, nema smisla na beku.
//
// Domenski tipovi (Booking, Apartment, AuthUser...) su u shared/types/index.ts
// =============================================================================

import type { ApiBooking } from '../../../shared/index';

// =============================================================================
// 📅 INTERNI BOOKING FORMAT (za render u kalendaru)
// =============================================================================

/**
 * Interna reprezentacija rezervacije unutar React statea.
 *
 * Razlikuje se od ApiBooking:
 *   - start/end su "yyyy-MM-dd" (ne ISO) — izbegavamo timezone probleme
 *   - color je uvek prisutan (frontend ga dodeljuje iz PALETTE)
 *   - isOptimistic flag za optimistic update prikaz
 *
 * Konverzija: ApiBooking → FrontendBooking se vrši u useCalendarData hooku.
 */
export interface FrontendBooking extends Omit<ApiBooking, 'startDate' | 'endDate' | 'status'> {
  /** Format: "yyyy-MM-dd" — npr. "2026-06-15" */
  start: string;
  /** Format: "yyyy-MM-dd" — npr. "2026-06-20" (inkluzivno) */
  end: string;
  /** Hex boja iz PALETTE */
  color: string;
  /**
   * true → Bar je privremeni (čeka API potvrdu) — prikazan poluprozirno.
   * false/undefined → Potvrđena rezervacija iz baze.
   */
  isOptimistic?: boolean;
}

// =============================================================================
// 🖱️  DRAG & DROP STATE
// =============================================================================

/**
 * State koji postoji dok korisnik vuče (drag) rezervaciju.
 * Životni ciklus: null → mouseDown → {id, startX, ...} → mouseUp → null
 */
export interface DraggingState {
  bookingId: string;
  apartmentId: string;
  /** Početna X pozicija miša pri mouseDown */
  startX: number;
  /** Originalni datumi za rollback ako drag završi u konfliktu */
  originalStart: Date;
  originalEnd: Date;
}

// =============================================================================
// 🖱️  SELEKCIJA ĆELIJA
// =============================================================================

/**
 * State koji postoji dok korisnik selektuje opseg slobodnih ćelija.
 * Životni ciklus: null → mouseDown → {aptId, startIndex, ...} → mouseUp → null
 */
export interface SelectionState {
  apartmentId: string;
  /** Indeks u days[] gde je selekcija počela */
  startIndex: number;
  /** Indeks u days[] gde selekcija trenutno završava (može biti < startIndex!) */
  endIndex: number;
}

/**
 * Izvedeni kalkulirani podaci iz SelectionState.
 * Računaju se jednom u useMemo, prosleđuju direktno modalima i overlay elementima.
 */
export interface SelData {
  startDate: Date;
  endDate: Date;
  /** Ukupan broj dana (endDate - startDate + 1) */
  totalDays: number;
  /** CSS left za overlay u px */
  left: number;
  /** CSS width za overlay u px */
  width: number;
  aptId: string;
  /** Indeks apartmana u nizu (za pozicioniranje modala) */
  aptIdx: number;
}

// =============================================================================
// 📊 KALKULACIJE I REZULTATI
// =============================================================================

/** Pozicija jednog booking bara u px — kešira se u BookingStylesMap */
export interface BookingStyleResult {
  left: number;
  width: number;
}

/** bookingId → {left, width} — sprečava ponovnu kalkulaciju pri svakom renderu */
export type BookingStylesMap = Record<string, BookingStyleResult>;

/** Statistike popunjenosti za tekući prikazani mesec */
export interface Stats {
  count: number;
  /** Procenat: (zauzetih dana / ukupnih dana × apartmana) × 100 */
  occupancy: number;
}

// =============================================================================
// 🧩 PROPS INTERFEJSI
// =============================================================================

export interface StatPillProps {
  label: string;
  value: string | number;
}

export interface ApiReservationRequest {
  id: string;
  guest: string;
  email: string;
  phone: string;
  startDate: string;
  endDate: string;
  apartment: { name: string };
  expiresAt: string;
}
