// =============================================================================
// ⚡ frontend/src/hooks/calendarActions.ts
// =============================================================================
//
// ČISTE ASYNC AKCIJE — bez React importa, bez hook-ova.
//
// Prethodno: BookingCalendar.handlers.ts (u components/ folderu)
// Premesteno ovde jer su ove funkcije logika, ne UI komponente.
//
// Sve funkcije koriste optimistic update pattern:
//   1. Odmah ažurirati UI
//   2. Poslati API zahtev
//   3. Greška → rollback + alert
//
// Testabilnost: Nema React importa — lako se testira bez DOM-a.
// =============================================================================
import type { Dispatch, SetStateAction } from 'react';
import type { FrontendBooking } from '../types/ui';
import type { SelData } from '../types/ui';
import { PALETTE } from '../../../shared/index';
import { formatDate, parseDateStr } from '../utils/dates';
import { logoutUser } from '../api/auth';
import {
  updateBooking as apiUpdate,
  deleteBooking as apiDelete,
  createBookingRequest,
  createBooking,
  type UpdateBookingPayload,
} from '../api/bookings';

// =============================================================================
// 🧮 UTILITY
// =============================================================================

/**
 * Provjera vremenskog preklapanja dvije rezervacije (inkluzivno).
 * Poziva se i tokom drag-a (vizuelna provjera) i pri kreiranju (sigurnosna).
 */
export function bookingsConflict(
  a: Pick<FrontendBooking, 'start' | 'end'>,
  b: FrontendBooking,
): boolean {
  const as = parseDateStr(a.start),
    ae = parseDateStr(a.end);
  const bs = parseDateStr(b.start),
    be = parseDateStr(b.end);
  return as < be && ae > bs;
}

// =============================================================================
// ✅ KREIRANJE / ZAHTEV
// =============================================================================

interface CreateBookingArgs {
  guestName: string;
  email: string;
  phone: string;
  selData: SelData | null;
  bookings: FrontendBooking[];
  setBookings: Dispatch<SetStateAction<FrontendBooking[]>>;
  setSelection: (v: null) => void;

  isAdmin: boolean;
}

export const executeCreateBooking = async ({
  guestName,
  email,
  phone,
  selData,
  bookings,
  setBookings,
  setSelection,
  isAdmin,
}: CreateBookingArgs): Promise<void> => {
  if (!guestName.trim() || !selData) return;

  // Lokalna provjera konflikta (server je pravi čuvar — ovo je UX)
  const hasConflict = bookings.some(
    (b) =>
      b.apartmentId === selData.aptId &&
      bookingsConflict(
        { start: formatDate(selData.startDate), end: formatDate(selData.endDate) },
        b,
      ),
  );
  if (hasConflict) {
    alert('Izabrani termin je zauzet!');
    return;
  }

  // Optimistički temp booking
  const tempId = `temp-${Date.now()}`;
  const tempBooking: FrontendBooking = {
    id: tempId,
    apartmentId: selData.aptId,
    start: formatDate(selData.startDate),
    end: formatDate(selData.endDate),
    guest: guestName.trim(),
    email,
    color: PALETTE[bookings.length % PALETTE.length],
    isOptimistic: true,
  };

  setBookings((prev) => [...prev, tempBooking]);
  setSelection(null);

  try {
    // 🔒 REŠENJE: Koristimo formatDate da izvučemo čist "YYYY-MM-DD" string
    // i ručno mu lepimo fiksnu UTC ponoć. Vremenska zona više ne može da pomeri datum unazad!
    const finalStartDateStr = `${formatDate(selData.startDate)}T00:00:00.000Z`;
    const finalEndDateStr = `${formatDate(selData.endDate)}T00:00:00.000Z`;

    const safeStartDate = new Date(finalStartDateStr);
    const safeEndDate = new Date(finalEndDateStr);

    safeStartDate.toISOString = () => finalStartDateStr;
    safeEndDate.toISOString = () => finalEndDateStr;

    if (isAdmin) {
      const created = await createBooking({
        apartmentId: selData.aptId,
        guest: guestName.trim(),
        startDate: safeStartDate,
        endDate: safeEndDate,
        email: email.trim(),
        phone: phone.trim() || undefined,
      });

      // Tvoj postojeći kod za ažuriranje lokalnog stanja rezervacija
      setBookings((prev) =>
        prev.map((b) => (b.id === tempId ? { ...b, id: created.id, isOptimistic: false } : b)),
      );
    } else {
      // 🌍 GOST / VIEWER: Pošto korisnik nije admin, šaljemo na našu novu javnu rutu!
      await createBookingRequest({
        apartmentId: selData.aptId,
        guest: guestName.trim(),
        startDate: safeStartDate,
        endDate: safeEndDate,
        email: email.trim(),
        phone: phone.trim() || undefined,
      });

      // 🧹 Pošto je ovo samo zahtev koji čeka odobrenje, sklanjamo privremenu traku sa kalendara
      setBookings((prev) => prev.filter((b) => b.id !== tempId));

      // Obaveštavamo gosta o uspehu
      alert('📬 Vaš zahtev je uspešno prosleđen adminu na odobrenje!');
    }

    // Zatvaramo modal resetovanjem selekcije na klijentu
    setSelection(null);
  } catch (err) {
    // Rollback
    setBookings((prev) => prev.filter((b) => b.id !== tempId));
    throw err; // Propagiraj grešku naniže (hook je hvata i prikazuje)
  }
};

// =============================================================================
// 🖱️  POMERANJE (DRAG & DROP)
// =============================================================================

interface MoveBookingFallback {
  originalStart: string;
  originalEnd: string;
}

export const executeMoveBooking = async (
  bookingId: string,
  newStart: string,
  newEnd: string,
  setBookings: Dispatch<SetStateAction<FrontendBooking[]>>,
  fallback: MoveBookingFallback,
): Promise<void> => {
  // Izvlačimo YYYY-MM-DD deo i sklapamo čiste ISO stringove za backend
  const dateRegex = /(\d{4}-\d{2}-\d{2})/;
  const matchStart = String(newStart).match(dateRegex);
  const matchEnd = String(newEnd).match(dateRegex);

  const cleanStart = matchStart ? matchStart[1] : String(newStart).slice(0, 10);
  const cleanEnd = matchEnd ? matchEnd[1] : String(newEnd).slice(0, 10);

  const isoStartString = `${cleanStart}T00:00:00.000Z`;
  const isoEndString = `${cleanEnd}T00:00:00.000Z`;

  try {
    const payload: UpdateBookingPayload = {
      startDate: isoStartString,
      endDate: isoEndString,
    };
    // Šaljemo ISO stringove direktno u API — bez Date objekata, bez timezone problema
    await apiUpdate(bookingId, payload);
  } catch (err) {
    setBookings((prev) =>
      prev.map((b) =>
        b.id !== bookingId ? b : { ...b, start: fallback.originalStart, end: fallback.originalEnd },
      ),
    );
    alert(err instanceof Error ? err.message : 'Greška pri pomeranju rezervacije');
    throw err;
  }
};

// =============================================================================
// 🗑️  BRISANJE (SOFT DELETE)
// =============================================================================

export const executeDeleteBooking = async (
  id: string,
  setBookings: Dispatch<SetStateAction<FrontendBooking[]>>,
): Promise<void> => {
  let backup: FrontendBooking | undefined;

  setBookings((prev) => {
    backup = prev.find((b) => b.id === id);
    return prev.filter((b) => b.id !== id);
  });

  try {
    await apiDelete(id);
  } catch (err) {
    if (backup) setBookings((prev) => [...prev, backup!]);
    throw err;
  }
};

// =============================================================================
// 🚪 ODJAVA
// =============================================================================

export const executeLogout = async (): Promise<boolean> => logoutUser();
