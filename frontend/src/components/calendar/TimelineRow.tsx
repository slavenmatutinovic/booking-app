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
  occupiedSet,
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

  const isOccupied = useCallback(
    (date: Date) => occupiedSet.has(`${apt.id}:${formatDate(date)}`),
    [occupiedSet, apt.id],
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
        if (!days[i] || isOccupied(days[i])) return false;
      }
      return true;
    },
    [days, isOccupied],
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
          const isOcc = isOccupied(day);
          const isPast = isPastDate(day);
          const isT = dateIsToday(day);
          const blocked = isOcc || isPast;

          return (
            <div
              key={i}
              className={[
                'cell',
                blocked ? 'occupied' : 'free',
                isT ? 'today' : '',
                isPast && !isOcc ? 'past' : '',
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
