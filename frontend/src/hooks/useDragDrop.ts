// =============================================================================
// 🪝 frontend/src/hooks/useDragDrop.ts
// =============================================================================
//
// Enkapsulira svu drag & drop logiku za booking barove.
//
// Problem koji rešava — stale closure:
//   Drag handler se kreira jednom pri mouseDown, ali bookings niz se menja.
//   Rešenje: bookingsRef.current uvek pokazuje na najnoviji niz
//   bez potrebe za ponovnim kreiranjem event listenera.
//
// Tok:
//   1. mouseDown na baru  → setDragging({bookingId, startX, originalDates})
//   2. mousemove          → izračunaj delta, optimistički pomeri booking
//   3. mouseup            → provjeri konflikt:
//                           - konflikt → rollback na originalne datume
//                           - ok       → PATCH /api/bookings/:id
// =============================================================================

import { useState, useEffect, useRef } from 'react';
import { addDays } from 'date-fns';
import type { FrontendBooking, DraggingState } from '../types/ui';
import { bookingsConflict, executeMoveBooking } from './calendarActions';
import { formatDate } from '../utils/dates';

interface UseDragDropProps {
  bookings: FrontendBooking[];
  setBookings: React.Dispatch<React.SetStateAction<FrontendBooking[]>>;
  canEdit: boolean;
  dayW: number;
}

interface UseDragDropResult {
  dragging: DraggingState | null;
  setDragging: (s: DraggingState | null) => void;
  dragValid: boolean;
}

export function useDragDrop({
  bookings, setBookings, canEdit, dayW,
}: UseDragDropProps): UseDragDropResult {

  const [dragging,  setDragging]  = useState<DraggingState | null>(null);
  const [dragValid, setDragValid] = useState(true);

  // Refs za stale-closure problem
  const bookingsRef = useRef<FrontendBooking[]>(bookings);
  const dayWRef     = useRef<number>(dayW);

  useEffect(() => { bookingsRef.current = bookings; }, [bookings]);
  useEffect(() => { dayWRef.current = dayW;          }, [dayW]);

  useEffect(() => {
    if (!dragging || !canEdit) return;

    const onMove = (e: MouseEvent) => {
      const current = bookingsRef.current;
      const delta   = Math.round((e.clientX - dragging.startX) / dayWRef.current);
      const newStart = addDays(dragging.originalStart, delta);
      const newEnd   = addDays(dragging.originalEnd,   delta);

      const tmp = { start: formatDate(newStart), end: formatDate(newEnd) };
      const conflict = current.some(b =>
        b.id !== dragging.bookingId &&
        b.apartmentId === dragging.apartmentId &&
        bookingsConflict(tmp, b)
      );

      setDragValid(!conflict);
      setBookings(prev => prev.map(b =>
        b.id !== dragging.bookingId
          ? b
          : { ...b, start: formatDate(newStart), end: formatDate(newEnd) }
      ));
    };

    const onUp = () => {
      const current = bookingsRef.current;
      const dragged = current.find(b => b.id === dragging.bookingId);

      if (dragged) {
        const conflict = current.some(b =>
          b.id !== dragging.bookingId &&
          b.apartmentId === dragged.apartmentId &&
          bookingsConflict(dragged, b)
        );

        if (conflict) {
          // Rollback
          setBookings(prev => prev.map(b =>
            b.id !== dragging.bookingId ? b : {
              ...b,
              start: formatDate(dragging.originalStart),
              end:   formatDate(dragging.originalEnd),
            }
          ));
        } else {
          // Sačuvaj na serveru
          executeMoveBooking(
            dragging.bookingId,
            dragged.start,
            dragged.end,
            setBookings,
            {
              originalStart: formatDate(dragging.originalStart),
              originalEnd:   formatDate(dragging.originalEnd),
            }
          );
        }
      }

      setDragging(null);
      setDragValid(true);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
    // bookings i dayW su namerno izostavljeni — koristimo ref-ove
  }, [dragging, setBookings, canEdit]);

  return { dragging, setDragging, dragValid };
}
