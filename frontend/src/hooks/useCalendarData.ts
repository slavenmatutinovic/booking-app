// =============================================================================
// 🪝 frontend/src/hooks/useCalendarData.ts
// =============================================================================
//
// Odgovornosti:
//   1. Paralelno učitava apartmane i rezervacije (Promise.all)
//   2. Konvertuje ApiBooking → FrontendBooking
//   3. Memoizuje bookingStyles i occupiedSet
//   4. Računa statistike (stats)
//   5. Izlaže createBooking, deleteBooking, handleLogoutClick akcije
//
// Razdvojen od useCalendarLayout — svaki hook ima jednu odgovornost.
// =============================================================================

import { useEffect, useState, useCallback, useMemo } from 'react';
import { differenceInCalendarDays, startOfMonth } from 'date-fns';

import type { Apartment, ApiBooking } from '../../../shared/index';
import { PALETTE } from '../../../shared/index';
import type { FrontendBooking, SelData, BookingStylesMap, Stats } from '../types/ui';

import { getApartments } from '../api/apartments';
import { getBookings } from '../api/bookings';
import { executeCreateBooking, executeDeleteBooking, executeLogout } from './calendarActions';
import { remoteLogger } from '../utils/remoteLogger';
import { parseDateStr, formatDate } from '../utils/dates';

// =============================================================================
// 📐 HELPER — bookingStyle kalkulacija (van hooka, ne uzrokuje re-render)
// =============================================================================

function calcBookingStyle(
  b: FrontendBooking,
  days: Date[],
  dayW: number,
): { left: number; width: number } | null {
  const s = parseDateStr(b.start);
  const e = parseDateStr(b.end);
  const first = days[0];
  const last = days[days.length - 1];
  const cs = s < first ? first : s;
  const ce = e > last ? last : e;
  if (cs > last || ce < first) return null;
  const startIdx = differenceInCalendarDays(cs, first);
  const span = differenceInCalendarDays(ce, cs) + 1;
  return { left: startIdx * dayW, width: span * dayW };
}

// =============================================================================
// 📋 HOOK PROPS
// =============================================================================

interface UseCalendarDataProps {
  days: Date[];
  dayW: number;
  startDate: Date;
  setSelection: (v: null) => void;
  isAdmin: boolean;
  canEdit: boolean;
  onLogout: () => void;
}

// =============================================================================
// 🪝 HOOK
// =============================================================================

export function useCalendarData({
  days,
  dayW,
  startDate,
  setSelection,
  isAdmin,
  canEdit,
  onLogout,
}: UseCalendarDataProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [bookings, setBookings] = useState<FrontendBooking[]>([]);

  const [bookingError, setBookingError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // ── Fetch pri montiravanju ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const [aptData, rawBookings] = await Promise.all([getApartments(), getBookings()]);
        if (cancelled) return;

        // 🚀 KORAK 1: Sortiramo rezervacije hronološki prema datumu početka
        // Ovo garantuje da rezerevacije unutar svakog apartmana idu redom po vremenskoj liniji
        const sortedRawBookings = [...(rawBookings as ApiBooking[])].sort(
          (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
        );

        // 🚀 KORAK 2: Pravimo brojač boja za SVAKI apartman pojedinačno
        // Ključ: apartmentId -> Vrednost: trenutni indeks boje iz PALETTE niza
        const apartmentColorCounters = new Map<string, number>();

        const formattedBookings: FrontendBooking[] = sortedRawBookings.map((b) => {
          // Čitamo trenutni indeks boje za ovaj specifičan apartman (ako nema unosa, krećemo od 0)
          const currentColorIdx = apartmentColorCounters.get(b.apartmentId) ?? 0;

          // Pomeramo brojač za 1 unapred za sledeću rezervaciju u ovom istom apartmanu
          apartmentColorCounters.set(b.apartmentId, currentColorIdx + 1);

          return {
            id: b.id,
            apartmentId: b.apartmentId,
            start: b.startDate.split('T')[0],
            end: b.endDate.split('T')[0],
            guest: b.guest || 'Gost',
            email: b.email,
            phone: b.phone,
            // 🚀 REŠENJE: Svaka naredna traka u istom apartmanu uzima sledeću boju iz palete.
            // Pošto idu u krug ciklično, uzastopne rezervacije NIKADA neće imati istu boju!
            color: PALETTE[currentColorIdx % PALETTE.length],
          };
        });

        setApartments(aptData ?? []);
        setBookings(formattedBookings);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Greška pri učitavanju');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [startDate]);

  // ── Memoizovane kalkulacije ────────────────────────────────────────────────

  /** bookingId → {left, width} u px */
  const bookingStyles = useMemo<BookingStylesMap>(() => {
    const map: BookingStylesMap = {};
    bookings.forEach((b) => {
      const style = calcBookingStyle(b, days, dayW);
      if (style) map[b.id] = style;
    });
    return map;
  }, [bookings, days, dayW]);

  /** Set zauzetih ćelija: "apartmentId:yyyy-MM-dd" → O(1) lookup */
  const occupiedSet = useMemo(() => {
    const set = new Set<string>();
    bookings.forEach((b) => {
      const start = parseDateStr(b.start);
      const end = parseDateStr(b.end);
      const current = new Date(start);
      while (current <= end) {
        set.add(`${b.apartmentId}:${formatDate(current)}`);
        current.setDate(current.getDate() + 1);
      }
    });
    return set;
  }, [bookings]);

  /** Statistike popunjenosti za tekući mesec */
  const stats = useMemo<Stats>(() => {
    const ms = startOfMonth(startDate);
    const me = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);

    const monthBookings = bookings.filter((b) => {
      const s = parseDateStr(b.start),
        e = parseDateStr(b.end);
      return s <= me && e >= ms;
    });

    const totalDays = monthBookings.reduce((sum, b) => {
      const s = parseDateStr(b.start),
        e = parseDateStr(b.end);
      const cs = s < ms ? ms : s;
      const ce = e > me ? me : e;
      return sum + differenceInCalendarDays(ce, cs) + 1;
    }, 0);

    const daysInMonth = me.getDate();
    const safeApartmentsCount = apartments?.length || 0;
    const totalSlots = daysInMonth * safeApartmentsCount;

    return {
      count: monthBookings.length,
      occupancy: totalSlots > 0 ? Math.round((totalDays / totalSlots) * 100) : 0,
    };
  }, [bookings, startDate, apartments]);

  // ── Akcije ────────────────────────────────────────────────────────────────

  const createBooking = useCallback(
    async (
      formData: { guestName: string; email: string; phone: string },
      selData: SelData | null,
    ) => {
      if (isCreating) return;
      setBookingError(null);
      setIsCreating(true);
      try {
        await executeCreateBooking({
          guestName: formData.guestName,
          email: formData.email,
          phone: formData.phone,
          selData,
          bookings,
          setBookings,
          setSelection,
          isAdmin,
        });

        // ✅ ČIŠĆENJE FORME: Pošto je slanje uspelo, ovde očisti modal / selekciju ako je potrebno
        setSelection(null); // Ovo će zatvoriti modal i resetovati selekciju
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Greška pri kreiranju rezervacije';
        setBookingError(msg);
        remoteLogger({ level: 'error', message: 'Neuspešno kreiranje', errorDetails: { msg } });
      } finally {
        setIsCreating(false);
      }
    },
    [bookings, isAdmin, isCreating, setSelection],
  );

  const deleteBooking = useCallback(
    async (id: string) => {
      if (!canEdit || isDeleting) return;
      setBookingError(null);
      setIsDeleting(true);
      try {
        await executeDeleteBooking(id, setBookings);
        remoteLogger({ level: 'info', message: 'Rezervacija obrisana', errorDetails: { id } });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Greška pri brisanju';
        setBookingError(msg);
        remoteLogger({ level: 'error', message: 'Neuspešno brisanje', errorDetails: { id, msg } });
      } finally {
        setIsDeleting(false);
      }
    },
    [canEdit, isDeleting],
  );

  const handleLogoutClick = async () => {
    try {
      await executeLogout();
    } catch (err) {
      console.error('Greška pri odjavi:', err);
    } finally {
      onLogout();
    }
  };

  return {
    apartments,
    bookings,
    loading,
    error,
    setBookings,
    createBooking,
    deleteBooking,
    handleLogoutClick,
    bookingError,
    isCreating,
    isDeleting,
    bookingStyles,
    occupiedSet,
    stats,
  };
}
