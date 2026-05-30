// frontend/src/hooks/useDragDrop.ts
import { useState, useCallback, useEffect, useRef } from 'react';
import type { DraggingState, FrontendBooking } from '../types/ui';

interface UseDragDropProps {
  canEdit: boolean;
  dayW: number;
  days: Date[];
  bookings: FrontendBooking[];
  onBookingUpdate: (
    bookingId: string,
    payload: { startDate: string; endDate: string },
  ) => Promise<void>;
}

// 🟢 Helper: Safely converts any input into a clean "YYYY-MM-DD" text segment without timezone shifts
function toDashString(dateInput: string | Date): string {
  if (typeof dateInput === 'string') {
    // If it's already an ISO string format, slice out the date part directly
    if (dateInput.includes('T')) {
      return dateInput.split('T')[0];
    }
    return dateInput;
  }

  const year = dateInput.getFullYear();
  const month = String(dateInput.getMonth() + 1).padStart(2, '0');
  const day = String(dateInput.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 🟢 Helper: Shifts a clean "YYYY-MM-DD" text string up or down using strict UTC boundaries
function shiftDateString(dateStr: string, daysToShift: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  // Instantiate using UTC values to isolate the object from browser clock variations
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + daysToShift);

  const rYear = utcDate.getUTCFullYear();
  const rMonth = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
  const rDay = String(utcDate.getUTCDate()).padStart(2, '0');
  return `${rYear}-${rMonth}-${rDay}`;
}

export const useDragDrop = ({ canEdit, dayW, bookings, onBookingUpdate }: UseDragDropProps) => {
  const [dragging, setDragging] = useState<DraggingState | null>(null);

  const [dragStatus, setDragStatus] = useState<{ valid: boolean; shift: number }>({
    valid: true,
    shift: 0,
  });

  const stateRef = useRef({ dragging, dragStatus, bookings });

  useEffect(() => {
    stateRef.current = { dragging, dragStatus, bookings };
  }, [dragging, dragStatus, bookings]);

  const startDrag = useCallback(
    (state: DraggingState) => {
      if (!canEdit) return;
      setDragging(state);
      setDragStatus({ valid: true, shift: 0 });
    },
    [canEdit],
  );

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      const { dragging: curDrag, dragStatus: curStatus, bookings: curBookings } = stateRef.current;
      if (!curDrag) return;

      const deltaX = e.clientX - curDrag.startX;
      const daysShifted = Math.round(deltaX / dayW);

      document.documentElement.style.setProperty('--drag-offset-x', `${deltaX}px`);

      // 1. Get clean base strings from the current dragged object
      const originalStartStr = toDashString(curDrag.originalStart);
      const originalEndStr = toDashString(curDrag.originalEnd);

      // 2. Add the shift offset using safe string math
      const newStartStr = shiftDateString(originalStartStr, daysShifted);
      const newEndStr = shiftDateString(originalEndStr, daysShifted);

      let isValid = true;

      // 3. Scan active booking items for overlaps
      for (const b of curBookings) {
        if (b.apartmentId !== curDrag.apartmentId) continue;
        if (b.id === curDrag.bookingId) continue;

        const bStartStr = toDashString(b.start);
        const bEndStr = toDashString(b.end);

        // Standard range check formula using clean string comparisons
        const hasOverlap = newStartStr < bEndStr && newEndStr > bStartStr;

        if (hasOverlap) {
          isValid = false;
          break;
        }
      }

      console.log('[DRAG DIAGNOSTICS - OVERLAP CHECK]', {
        daysShifted,
        calculatedValid: isValid,
        targetStart: newStartStr,
        targetEnd: newEndStr,
      });

      if (daysShifted !== curStatus.shift || isValid !== curStatus.valid) {
        setDragStatus({
          shift: daysShifted,
          valid: isValid,
        });
      }
    };

    const handleGlobalMouseUp = async (e: MouseEvent) => {
      const { dragging: curDrag, dragStatus: curStatus } = stateRef.current;
      if (!curDrag) return;

      const deltaX = e.clientX - curDrag.startX;
      const daysShifted = Math.round(deltaX / dayW);

      document.documentElement.style.removeProperty('--drag-offset-x');

      setDragging(null);
      setDragStatus({ valid: true, shift: 0 });

      // Save changes to the database only if the placement is valid and has shifted
      if (curStatus.valid && daysShifted !== 0) {
        const originalStartStr = toDashString(curDrag.originalStart);
        const originalEndStr = toDashString(curDrag.originalEnd);

        const finalStartStr = shiftDateString(originalStartStr, daysShifted);
        const finalEndStr = shiftDateString(originalEndStr, daysShifted);

        // Build clean ISO string payloads with the time forced to midnight UTC
        const payload = {
          startDate: `${finalStartStr}T00:00:00.000Z`,
          endDate: `${finalEndStr}T00:00:00.000Z`,
        };

        try {
          await onBookingUpdate(curDrag.bookingId, payload);
        } catch (err) {
          console.error('Greška tokom drag-and-drop snimanja:', err);
        }
      }
    };

    if (dragging) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [dragging, dayW, onBookingUpdate]);

  return {
    dragging,
    dragValid: dragStatus.valid,
    startDrag,
  };
};
