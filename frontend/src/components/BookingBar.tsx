// =============================================================================
// 🟦 frontend/src/components/BookingBar.tsx
// =============================================================================
//
// Vizuelni bar jedne rezervacije u timeline-u.
//
// Izmene u odnosu na original:
//   - Tip b je FrontendBooking (ne Booking iz starog types/index.ts)
//   - Tooltip je podkomponenta BookingTooltip — manja odgovornost
//   - memo() ostaje — sprečava re-render barova koji se nisu promenili
// =============================================================================

import { memo } from 'react';
import { differenceInCalendarDays } from 'date-fns';
import type { FrontendBooking, DraggingState } from '../types/ui';
import { parseDateStr, fmtShort } from '../utils/dates';

// =============================================================================
// 💬 BookingTooltip — izdvojen za preglednost
// =============================================================================

function BookingTooltip({
  b,
  showGuestDetails,
  canEdit,
}: {
  b: FrontendBooking;
  showGuestDetails: boolean;
  canEdit: boolean;
}) {
  if (!showGuestDetails) {
    return (
      <div className="tooltip" role="tooltip">
        <div className="tooltip-title">Zauzeto</div>
        <div className="tooltip-dates">
          {fmtShort(parseDateStr(b.start))} {' → '} {fmtShort(parseDateStr(b.end))}
        </div>
      </div>
    );
  }

  return (
    <div className="tooltip" role="tooltip">
      <div className="tooltip-title">{b.guest}</div>
      <div className="tooltip-dates">
        {fmtShort(parseDateStr(b.start))} {' → '} {fmtShort(parseDateStr(b.end))}
      </div>
      <div className="tooltip-days">
        {differenceInCalendarDays(parseDateStr(b.end), parseDateStr(b.start)) + 1} dana
      </div>
      {canEdit && (
        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>Prevuci za pomeranje</div>
      )}
    </div>
  );
}

// =============================================================================
// 📋 PROPS
// =============================================================================

interface BookingBarProps {
  b: FrontendBooking;
  styleCache: { left: number; width: number } | undefined;
  isDrag: boolean;
  dragValid: boolean;
  isHovered: boolean;
  canEdit: boolean;
  showGuestDetails: boolean;
  isDeleting: boolean;
  setDragging: (state: DraggingState | null) => void;
  setHoveredId: (id: string | null) => void;
  deleteBooking: (id: string) => void;
}

// =============================================================================
// 🟦 KOMPONENTA
// =============================================================================

export const BookingBar = memo(
  ({
    b,
    styleCache,
    isDrag,
    dragValid,
    isHovered,
    canEdit,
    showGuestDetails,
    isDeleting,
    setDragging,
    setHoveredId,
    deleteBooking,
  }: BookingBarProps) => {
    if (!styleCache) return null;

    const opacity = b.isOptimistic
      ? 0.5
      : isDeleting && isHovered
        ? 0.4
        : isDrag
          ? dragValid
            ? 0.75
            : 0.4
          : 1;

    const cursor = b.isOptimistic
      ? 'not-allowed'
      : canEdit
        ? isDrag
          ? 'grabbing'
          : 'grab'
        : 'default';

    return (
      <div
        className={[
          'booking',
          isDrag ? 'dragging' : '',
          isDrag && !dragValid ? 'invalid' : '',
          b.isOptimistic ? 'optimistic-pulse' : '',
          isDeleting && isHovered ? 'deleting-pulse' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          left: styleCache.left + 3,
          width: styleCache.width - 6,
          background: b.color,
          opacity,
          pointerEvents: b.isOptimistic || isDeleting ? 'none' : 'auto',
          cursor,
        }}
        onMouseDown={(e) => {
          if (!canEdit || b.isOptimistic || isDeleting) return;
          e.stopPropagation();
          setDragging({
            bookingId: b.id,
            apartmentId: b.apartmentId,
            startX: e.clientX,
            originalStart: parseDateStr(b.start),
            originalEnd: parseDateStr(b.end),
          });
        }}
        onMouseEnter={() => !isDeleting && setHoveredId(b.id)}
        onMouseLeave={() => setHoveredId(null)}
        onContextMenu={(e) => {
          if (!canEdit || isDeleting) return;
          e.preventDefault();
          deleteBooking(b.id);
        }}
      >
        {/* Naziv / "Zauzeto" */}
        <span className="booking-title">
          {showGuestDetails ? b.guest : 'Zauzeto'}
          {b.isOptimistic && ' ⏳'}
        </span>

        {/* X dugme pri hoveru — samo admin */}
        {canEdit && isHovered && !isDrag && (
          <button
            className={`booking-delete${isDeleting ? ' disabled' : ''}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              deleteBooking(b.id);
            }}
            disabled={isDeleting}
            aria-label={`Obriši rezervaciju za ${b.guest}`}
          >
            ×
          </button>
        )}

        {/* Tooltip */}
        {isHovered && !isDrag && (
          <BookingTooltip b={b} showGuestDetails={showGuestDetails} canEdit={canEdit} />
        )}
      </div>
    );
  },
);

BookingBar.displayName = 'BookingBar';
