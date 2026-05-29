// =============================================================================
// 🟦 frontend/src/components/calendar/TimelineRow.tsx
// =============================================================================
//
// Jedan red u timeline-u — odgovara jednom apartmanu.
//
// Sadrži:
//   - Ćelije slobodnih/zauzetih dana (klikabilne za selekciju)
//   - SelectionOverlay (plavi pravougaonik tokom selekcije)
//   - BookingBar po svakoj rezervaciji
// =============================================================================

import React, { useCallback } from 'react';
import type { Apartment } from '../../../../shared/index';
import type {
  FrontendBooking,
  DraggingState,
  SelectionState,
  BookingStylesMap,
} from '../../types/ui';
import { BookingBar } from '../BookingBar';
import { formatDate, isToday as dateIsToday } from '../../utils/dates';
import { startOfDay } from 'date-fns';

// =============================================================================
// 📋 PROPS (Potpuno usklađeni i očišćeni od prop-drilling tereta)
// =============================================================================
interface TimelineRowProps {
  apt: Apartment;
  days: Date[];
  dayW: number;
  occupiedSet: Set<string>;
  bookings: FrontendBooking[];
  bookingStyles: BookingStylesMap;
  selection: SelectionState | null;
  setSelection: React.Dispatch<React.SetStateAction<SelectionState | null>>;
  isSelecting: boolean;
  setIsSelecting: (v: boolean) => void;
  dragging: DraggingState | null;
  setDragging: (s: DraggingState | null) => void;
  dragValid: boolean;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  canEdit: boolean;
  isGuest: boolean;
  deleteBooking: (id: string) => void | Promise<void>; // ✅ Zadržano za unutrašnje brisanje traka
  isDeleting: boolean; // ✅ Zadržano za vizuelne loading efekte
}

// =============================================================================
// 🟦 KOMPONENTA
// =============================================================================
export function TimelineRow({
  apt,
  days,
  dayW,

  bookings,
  bookingStyles,
  selection,
  setSelection,
  isSelecting,
  setIsSelecting,
  dragging,
  setDragging,
  dragValid,
  hoveredId,
  setHoveredId,
  canEdit,
  isGuest,
  deleteBooking,
  isDeleting,
}: TimelineRowProps) {
  const today = startOfDay(new Date());

  // 1. Provera da li je dan ČVRSTO zauzet (sredina tuđeg boravka)
  const isSolidOccupied = useCallback(
    (date: Date) => {
      const dateStr = formatDate(date);

      // Prolazimo kroz sve rezervacije za ovaj konkretan apartman
      return bookings.some((b) => {
        // Gost provodi noć u sobi ako je dan između starta i kraja,
        // ali ako je dan TAČNO b.end, onda gost izlazi i dan je SLOBODAN za novi Check-in!
        return dateStr >= b.start && dateStr < b.end; // 🔒 Ključ: strogo manje od b.end
      });
    },
    [bookings],
  );

  const isPastDate = (date: Date) => date < today;

  /**
   * Provjera da li se opseg [i0, i1] može selektovati (sve ćelije slobodne).
   */
  const canSelect = useCallback(
    (i0: number, i1: number): boolean => {
      const lo = Math.min(i0, i1);
      const hi = Math.max(i0, i1);
      for (let i = lo; i <= hi; i++) {
        if (!days[i] || isSolidOccupied(days[i])) return false;
      }
      return true;
    },
    [days, isSolidOccupied],
  );

  // Bezbedno čitanje selekcije za vizuelni overlay plavog pravougaonika
  const currentSelectionForThisApt = selection && selection.apartmentId === apt.id;

  const selectionStyle = React.useMemo(() => {
    if (!currentSelectionForThisApt) return null;
    const lo = Math.min(selection.startIndex, selection.endIndex);
    const hi = Math.max(selection.startIndex, selection.endIndex);
    return {
      left: lo * dayW + 2,
      width: (hi - lo + 1) * dayW - 4,
    };
  }, [currentSelectionForThisApt, selection, dayW]);

  return (
    <div className="row">
      {/* ── Ćelije ────────────────────────────────────────────────────── */}
      <div className="row-cells">
        {days.map((day, i) => {
          const isSolidOcc = isSolidOccupied(day);
          const isPast = isPastDate(day);
          const isT = dateIsToday(day);
          const blocked = isSolidOcc || isPast;

          return (
            <div
              key={i}
              className={[
                'cell',
                blocked ? 'occupied' : 'free',
                isT ? 'today' : '',
                isPast && !isSolidOcc ? 'past' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseDown={() => {
                if (blocked) return;
                setIsSelecting(true);
                setSelection({ apartmentId: apt.id, startIndex: i, endIndex: i });
              }}
              onMouseEnter={() => {
                if (!isSelecting || !selection) return;
                if (selection.apartmentId !== apt.id) return;

                // Dozvoljavamo selekciju u oba smera (unazad i unapred)
                if (canSelect(selection.startIndex, i)) {
                  setSelection((s) => (s ? { ...s, endIndex: i } : s));
                }
              }}
              onMouseUp={() => setIsSelecting(false)}
            />
          );
        })}
      </div>

      {/* ── Selekcija overlay (Iscrtava plavu traku isključivo tokom prevlačenja miša) ── */}
      {selectionStyle && <div className="selection" style={selectionStyle} />}

      {/* ── Booking barovi ────────────────────────────────────────────── */}
      {bookings.map((b) => (
        <BookingBar
          key={b.id}
          b={b}
          styleCache={bookingStyles[b.id]}
          isDrag={dragging?.bookingId === b.id}
          dragValid={dragValid}
          isHovered={hoveredId === b.id}
          canEdit={canEdit}
          showGuestDetails={!isGuest}
          setDragging={setDragging}
          setHoveredId={setHoveredId}
          isDeleting={isDeleting}
          deleteBooking={deleteBooking} // ✅ Stabilna i očišćena referenca prosleđena naniže
        />
      ))}

      {/* 🚀 ODAVDE JE UKLONJEN STARI MODAL — SADA ŽIVI SAMO JEDNOM PREKO PORTALA NA KORENU! */}
    </div>
  );
}
