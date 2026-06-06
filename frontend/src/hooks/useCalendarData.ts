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
import { addDays, differenceInCalendarDays, format, startOfMonth } from 'date-fns';

import type { Apartment, ApiBooking } from '../../../shared/index';
import { PALETTE } from '../../../shared/index';
import type { FrontendBooking, SelData, BookingStylesMap, Stats } from '../types/ui';

import { getApartments } from '../api/apartments';
import { getBookings } from '../api/bookings';
import {
  executeCreateBooking,
  executeDeleteBooking,
  executeLogout,
  executeMoveBooking,
} from './calendarActions';
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

  // 🔒 VIZUELNO HOTELSKO PRAVILO (Pomeranje za pola ćelije)
  // Širina jedne ćelije je npr. 40px. Polovina je 20px.
  const halfCell = dayW / 2;

  // Traka vizuelno ne kreće od same ivice dana, već se pomera udesno za pola dana (Check-in od 14h)
  const leftPosition = startIdx * dayW + halfCell;

  // Širina trake se smanjuje za širinu jednog celog dana (jer prva i poslednja ćelija dele po polovinu)
  const visualWidth = span * dayW - dayW;
  return { left: leftPosition, width: visualWidth };
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

  // 🔒 REŠENJE: Računamo tačan opseg vidljivih meseci na ekranu
  // Iz niza 'days' uzimamo prvi i poslednji dan koji admin vidi na kalendaru
  const firstVisibleDay = days[0] || startDate;
  const lastVisibleDay = days[days.length - 1] || addDays(startDate, 35);

  const startMonthStr = format(firstVisibleDay, 'yyyy-MM');
  const endMonthStr = format(lastVisibleDay, 'yyyy-MM');

  const refreshCalendarData = useCallback(
    async (cancelledRef: { current: boolean }): Promise<void> => {
      try {
        setLoading(true);
        setError(null);

        const [aptData, firstPageEnvelope] = await Promise.all([
          getApartments(),
          getBookings({ startMonth: startMonthStr, endMonth: endMonthStr, cursor: undefined }),
        ]);
        if (cancelledRef.current) return;

        let rawBookings = firstPageEnvelope?.bookings || [];
        let nextCursor = firstPageEnvelope?.nextCursor;

        // Paginacioni krug za povlačenje svih stranica rezervacija
        while (nextCursor && !cancelledRef.current) {
          const nextPageEnvelope = await getBookings({
            startMonth: startMonthStr,
            endMonth: endMonthStr,
            cursor: nextCursor,
          });

          if (nextPageEnvelope?.bookings) {
            rawBookings = [...rawBookings, ...nextPageEnvelope.bookings];
          }
          nextCursor = nextPageEnvelope?.nextCursor;
        }

        if (cancelledRef.current) return;

        const sortedRawBookings = [...(rawBookings as ApiBooking[])].sort(
          (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
        );

        const apartmentColorCounters = new Map<string, number>();

        const formattedBookings: FrontendBooking[] = sortedRawBookings.map((b) => {
          const currentColorIdx = apartmentColorCounters.get(b.apartmentId) ?? 0;
          apartmentColorCounters.set(b.apartmentId, currentColorIdx + 1);

          return {
            id: b.id,
            apartmentId: b.apartmentId,
            start: b.startDate.split('T')[0],
            end: b.endDate.split('T')[0],
            guest: b.guest || 'Gost',
            email: b.email,
            phone: b.phone,
            color: PALETTE[currentColorIdx % PALETTE.length],
            totalPrice: b.totalPrice,
          };
        });

        setApartments(aptData ?? []);
        setBookings(formattedBookings);
      } catch (err) {
        if (!cancelledRef.current) {
          setError(err instanceof Error ? err.message : 'Greška pri učitavanju');
        }
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
      // ✅ DODATE SVE ZAVISNOSTI: Sve funkcije i promenljive koje kôd koristi unutra
    },
    [startMonthStr, endMonthStr, setLoading, setError, setApartments, setBookings],
  );
  // ── Fetch pri montiravanju ─────────────────────────────────────────────────
  useEffect(() => {
    const status = { current: false };

    Promise.resolve().then(() => {
      if (!status.current) {
        refreshCalendarData(status);
      }
    });

    return () => {
      status.current = true;
    };
  }, [refreshCalendarData]);

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

      // 🛡️ REŠENJE ZA POTENCIJALNI NULL: Ako selekcija ne postoji, odmah prekidamo izvršavanje
      if (!selData) {
        setBookingError('Nema aktivne selekcije datuma.');
        return;
      }

      setBookingError(null);
      setIsCreating(true);
      try {
        await executeCreateBooking({
          aptId: String(selData.aptId).trim(),
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

  const updateBooking = useCallback(
    async (bookingId: string, payload: { startDate: string; endDate: string }) => {
      // Pronalazimo originalnu rezervaciju u trenutnom stanju kako bismo obezbedili fallback podatke za rollback
      const currentBooking = bookings.find((b) => b.id === bookingId);
      if (!currentBooking) return;

      setBookingError(null);

      // Izdvajamo samo YYYY-MM-DD deo iz ISO stringa koji stiže iz kuke za potrebe klijentskog stanja
      const newStartDay = payload.startDate.split('T')[0];
      const newEndDay = payload.endDate.split('T')[0];

      // Prvo radimo optimistično ažuriranje na klijentu (instant vizuelni efekat)
      setBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, start: newStartDay, end: newEndDay } : b)),
      );

      try {
        // Pozivamo tvoju akciju iz calendarActions.ts koja komunicira sa API-jem
        await executeMoveBooking(bookingId, payload.startDate, payload.endDate, setBookings, {
          originalStart: currentBooking.start,
          originalEnd: currentBooking.end,
        });

        remoteLogger({
          level: 'info',
          message: 'Rezervacija uspešno pomerena i sinhronizovana.',
          errorDetails: { bookingId },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Greška pri pomeranju rezervacije';
        setBookingError(msg);
        remoteLogger({
          level: 'error',
          message: 'Neuspešno mrežni sinhronizacija pomeranja',
          errorDetails: { bookingId, msg },
        });
        throw err; // Propagiramo grešku kako bi useDragDrop kuka očistila efekte
      }
    },
    [bookings], // Zavisi od trenutnog niza bookings kako bismo očitali stare datume pre izmene
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
      remoteLogger({ level: 'error', message: 'Neuspešno odjavljivanje', errorDetails: { err } });
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
    updateBooking,
    handleLogoutClick,
    bookingError,
    isCreating,
    isDeleting,
    bookingStyles,
    occupiedSet,
    stats,
  };
}
