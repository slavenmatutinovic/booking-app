// =============================================================================
// 📆 frontend/src/components/calendar/CalendarTimeline.tsx
// =============================================================================
//
// Timeline: header sa datumima + redovi po apartmanu.
//
// Odgovornosti:
//   - Prikazuje header (datumi)
//   - Renderuje "danas" liniju
//   - Iterira apartmane → TimelineRow po apartmanu
//   - Prosleđuje scroll event gore u roditeljsku komponentu
// =============================================================================

import React, { forwardRef, useMemo } from 'react';
import { isToday, isSameMonth } from 'date-fns';
import type { Apartment } from '../../../../shared/index';
import type {
  FrontendBooking,
  DraggingState,
  SelectionState,
  BookingStylesMap,
} from '../../types/ui';
import { TimelineRow } from './TimelineRow';
import { fmtDay, fmtDayShort, formatDate } from '../../utils/dates';

interface CalendarTimelineProps {
  days: Date[];
  startDate: Date;
  apartments: Apartment[];
  bookings: FrontendBooking[];
  bookingStyles: BookingStylesMap;
  occupiedSet: Set<string>;
  dayW: number;
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
  deleteBooking: (id: string) => void | Promise<void>; // ✅ Zadržano za brisanje traka
  isDeleting: boolean; // ✅ Zadržano za brisanje traka
  scrollLeft: number;
  setScrollLeft: (v: number) => void;
}

export const CalendarTimeline = forwardRef<HTMLDivElement, CalendarTimelineProps>(
  function CalendarTimeline(props, ref) {
    const {
      days,
      startDate,
      apartments,
      bookings,
      bookingStyles,
      occupiedSet,
      dayW,
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
      deleteBooking, // ✅ Pokupljeno iz props
      isDeleting, // ✅ Pokupljeno iz props

      setScrollLeft,
    } = props;

    // Indeks "danas" kolone za vertikalnu liniju
    const todayStr = formatDate(new Date());
    const todayIdx = useMemo(
      () => days.findIndex((d) => formatDate(d) === todayStr),
      [days, todayStr],
    );

    return (
      <div
        ref={ref}
        className="timeline"
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
      >
        {/* ── Header: datumi ──────────────────────────────────────────── */}
        <div className="timeline-header">
          {days.map((day, i) => {
            const isT = isToday(day);
            const inMonth = isSameMonth(day, startDate);
            return (
              <div key={i} className={`day-header${isT ? ' today' : ''}`}>
                <span className={`day-number${isT ? ' today' : ''}${!inMonth ? ' outside' : ''}`}>
                  {fmtDay(day)}
                </span>
                <span className={`day-name${isT ? ' today' : ''}${!inMonth ? ' outside' : ''}`}>
                  {fmtDayShort(day)}
                </span>
              </div>
            );
          })}
        </div>

        {/* ── Redovi ──────────────────────────────────────────────────── */}
        <div className="rows">
          {/* Linija "danas" */}
          {todayIdx >= 0 && (
            <div className="today-line" style={{ left: todayIdx * dayW + dayW / 2 }} />
          )}

          {apartments.map((apt) => (
            <TimelineRow
              key={apt.id}
              apt={apt}
              days={days}
              dayW={dayW}
              occupiedSet={occupiedSet}
              bookings={bookings.filter((b) => b.apartmentId === apt.id)}
              bookingStyles={bookingStyles}
              selection={selection}
              setSelection={setSelection}
              isSelecting={isSelecting}
              setIsSelecting={setIsSelecting}
              dragging={dragging}
              setDragging={setDragging}
              dragValid={dragValid}
              hoveredId={hoveredId}
              setHoveredId={setHoveredId}
              canEdit={canEdit}
              isGuest={isGuest}
              deleteBooking={deleteBooking} // ✅ Prosleđeno u TimelineRow
              isDeleting={isDeleting} // ✅ Prosleđeno u TimelineRow
            />
          ))}
        </div>
      </div>
    );
  },
);
