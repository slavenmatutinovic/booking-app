// frontend/src/hooks/useDragDrop.ts
import { useState, useCallback, useEffect, useRef } from 'react';
import type { DraggingState, FrontendBooking } from '../types/ui';
import { remoteLogger } from '../utils/remoteLogger';
import { calculateClientDynamicPrice } from '../utils/pricingCalculator';
import { Apartment } from '../../../shared';

interface UseDragDropProps {
  canEdit: boolean;
  dayW: number;
  days: Date[];
  bookings: FrontendBooking[];
  apartments: Apartment[];
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

export const useDragDrop = ({
  canEdit,
  dayW,
  bookings,
  onBookingUpdate,
  apartments,
}: UseDragDropProps) => {
  const [dragging, setDragging] = useState<DraggingState | null>(null);
  const [dragValid, setDragValid] = useState<boolean>(true);
  const [dragStatus, setDragStatus] = useState<{ valid: boolean; shift: number }>({
    valid: true,
    shift: 0,
  });

  const stateRef = useRef({ dragging, dragValid, dragStatus, bookings, apartments });

  useEffect(() => {
    stateRef.current = { dragging, dragValid, dragStatus, bookings, apartments };
  }, [dragging, dragValid, dragStatus, bookings, apartments]);

  const startDrag = useCallback(
    (
      // 🛡️ REŠENJE: Govorimo kompajleru da nam live preview tekstovi i cena ne trebaju na samom startu
      initialState: Omit<DraggingState, 'currentStartStr' | 'currentEndStr' | 'currentLivePrice'>,
    ) => {
      if (!canEdit) return;

      const startStr = toDashString(initialState.originalStart);
      const endStr = toDashString(initialState.originalEnd);

      // Sastavljamo pun DraggingState objekat unutar React state-a
      setDragging({
        ...initialState,
        currentStartStr: startStr,
        currentEndStr: endStr,
        currentLivePrice: 0, // Početna cena pre pomeranja miša
      });
      setDragValid(true);
    },
    [canEdit],
  );

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      const {
        dragging: curDrag,
        dragStatus: curStatus,
        bookings: curBookings,
        apartments: curApartments,
      } = stateRef.current;
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
      if (import.meta.env.DEV) {
        console.log('[DRAG DIAGNOSTICS - OVERLAP CHECK]', {
          daysShifted,
          calculatedValid: isValid,
          targetStart: newStartStr,
          targetEnd: newEndStr,
        });
      }
      if (daysShifted !== curStatus.shift || isValid !== curStatus.valid) {
        setDragStatus({
          shift: daysShifted,
          valid: isValid,
        });
      }

      // 2. Compute dynamic price matrix shifts using your official client engine
      let livePriceCalculated = 0;
      const currentApartment = curApartments.find((a: Apartment) => a.id === curDrag.apartmentId);

      if (currentApartment) {
        // Fire the calculation engine using strictly defined custom seasonal records
        const priceCalculationEnvelope = calculateClientDynamicPrice(
          newStartStr,
          newEndStr,
          currentApartment.rates || [],
        );

        // If a night falls into an unconfigured gap, you can choose to mark the drag placement as invalid
        // if (priceCalculationEnvelope.hasUnconfiguredDays) isValid = false;

        livePriceCalculated = priceCalculationEnvelope.totalPrice;
      }

      if (
        newStartStr !== curDrag.currentStartStr ||
        newEndStr !== curDrag.currentEndStr ||
        livePriceCalculated !== curDrag.currentLivePrice
      ) {
        setDragging({
          ...curDrag,
          currentStartStr: newStartStr,
          currentEndStr: newEndStr,
          currentLivePrice: livePriceCalculated, // Assigned and safely consumed here
        });
      }

      // Set grid validation state flags to visually toggle colors (e.g. green for valid, red for error)
      if (isValid !== dragValid) {
        setDragValid(isValid);
      }
    };

    const handleGlobalMouseUp = async (e: MouseEvent) => {
      const { dragging: curDrag, dragValid: currentDragValid } = stateRef.current;
      if (!curDrag) return;

      const deltaX = e.clientX - curDrag.startX;
      const daysShifted = Math.round(deltaX / dayW);

      document.documentElement.style.removeProperty('--drag-offset-x');

      setDragging(null);
      setDragStatus({ valid: true, shift: 0 });

      // Save changes to the database only if the placement is valid and has shifted
      if (currentDragValid && daysShifted !== 0) {
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
          remoteLogger({
            level: 'error',
            message: '❌ updateApartment — greška pri upisu',
            errorDetails: { err },
          });
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
  }, [dragging, dragValid, dayW, onBookingUpdate]);

  return {
    dragging,
    dragValid: dragging ? dragValid : true,
    startDrag,
  };
};
