// frontend/src/hooks/useDragDrop.ts

import { useState, useCallback } from 'react';
import { addDays } from 'date-fns';
import type { DraggingState } from '../types/ui';
import { formatDate } from '../utils/dates';

interface UseDragDropProps {
  canEdit: boolean;
  dayW: number;
  days: Date[];
  onBookingUpdate: (
    bookingId: string,
    payload: { startDate: string; endDate: string },
  ) => Promise<void>;
}

export const useDragDrop = ({ canEdit, dayW, days, onBookingUpdate }: UseDragDropProps) => {
  // Držimo se tvog originalnog DraggingState tipa iz ui.ts
  const [dragging, setDragging] = useState<DraggingState | null>(null);
  const [dragValid] = useState<boolean>(true);

  // Pokretanje drag procesa na klik miša
  const startDrag = useCallback(
    (state: DraggingState) => {
      if (!canEdit) return;
      setDragging(state);

      // Postavljamo početni CSS offset na 0 piksela na HTML koren aplikacije
      document.documentElement.style.setProperty('--drag-offset-x', '0px');
    },
    [canEdit],
  );

  // Globalni handler za pomeranje miša - SADA KORISTI PIKSELE ZA MAKSIMALNU GLATKOĆU
  const handleGlobalMouseMove = useCallback(
    (clientX: number) => {
      if (!dragging) return;

      // Računamo tačan pomeraj miša u pikselima
      const deltaX = clientX - dragging.startX;

      // Direktno menjamo CSS varijablu na ekranu.
      // Browser ovo pomera trenutno (60+ FPS) jer preskače skupi React re-render!
      document.documentElement.style.setProperty('--drag-offset-x', `${deltaX}px`);
    },
    [dragging],
  );

  // Globalni handler za puštanje miša (kraj drag-and-drop procesa)
  const handleGlobalMouseUp = useCallback(
    async (clientX: number) => {
      if (!dragging) return;

      const deltaX = clientX - dragging.startX;

      // Na osnovu ukupnog pomeraja u pikselima, računamo konačan offset u danima
      const daysOffset = Math.round(deltaX / dayW);

      // Čistimo CSS varijablu sa ekrana odmah po završetku
      document.documentElement.style.removeProperty('--drag-offset-x');
      setDragging(null);

      // Ako se traka na kraju nije pomerila za ceo dan, prekidamo i ne trošimo API
      if (daysOffset === 0) return;

      // Računamo nove datume dodavanjem offseta na originalne Date objekte
      const newStartDate = addDays(dragging.originalStart, daysOffset);
      const newEndDate = addDays(dragging.originalEnd, daysOffset);

      // Granice trenutno vidljivog kalendara
      const minCalendarDate = days[0];
      const maxCalendarDate = days[days.length - 1];

      if (newStartDate < minCalendarDate || newEndDate > maxCalendarDate) {
        console.warn('⚠️ Rezervacija je izvučena van granica kalendara.');
        return;
      }

      try {
        const newStartDateISO = `${formatDate(newStartDate)}T00:00:00.000Z`;
        const newEndDateISO = `${formatDate(newEndDate)}T00:00:00.000Z`;

        // Šaljemo samo jedan API zahtev na backend
        await onBookingUpdate(dragging.bookingId, {
          startDate: newStartDateISO,
          endDate: newEndDateISO,
        });
      } catch (error: unknown) {
        console.error('❌ Greška prilikom snimanja pomerene rezervacije:', error);
      }
    },
    [dragging, dayW, days, onBookingUpdate],
  );

  return {
    dragging,
    dragValid,
    startDrag,
    handleGlobalMouseMove,
    handleGlobalMouseUp,
  };
};
