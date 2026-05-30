// frontend/src/components/BookingBar.tsx

import { memo } from 'react';
import { differenceInCalendarDays } from 'date-fns';
import type { FrontendBooking, DraggingState } from '../types/ui';
import { parseDateStr, fmtShort } from '../utils/dates';

// =============================================================================
// 💬 BookingTooltip — izdvojen za preglednost
// =============================================================================

interface BookingTooltipProps {
  b: FrontendBooking;
  showGuestDetails: boolean;
  canEdit: boolean;
}

function BookingTooltip({ b, showGuestDetails, canEdit }: BookingTooltipProps) {
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

  // Računamo broj dana bez mutacije i na tipski bezbedan način
  const totalDays = differenceInCalendarDays(parseDateStr(b.end), parseDateStr(b.start)) + 1;

  return (
    <div className="tooltip" role="tooltip">
      <div className="tooltip-title">{b.guest}</div>
      <div className="tooltip-dates">
        {fmtShort(parseDateStr(b.start))} {' → '} {fmtShort(parseDateStr(b.end))}
      </div>
      <div className="tooltip-days">{totalDays} dana</div>
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

const BookingBarComponent = ({
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

  // Proračun opaciteta na osnovu stanja rezervacije
  const opacity = b.isOptimistic
    ? 0.5
    : isDeleting && isHovered
      ? 0.4
      : isDrag
        ? dragValid
          ? 0.75
          : 0.4
        : 1;

  // Definišemo kursor tipski bezbedno
  const cursor: React.CSSProperties['cursor'] = b.isOptimistic
    ? 'not-allowed'
    : canEdit
      ? isDrag
        ? 'grabbing'
        : 'grab'
      : 'default';
  // Ako se ova traka trenutno prevlači, primenjujemo CSS varijablu u pikselima.
  // Ako se ne prevlači, nema nikakvog pomeranja.
  const transform = isDrag ? 'translateX(var(--drag-offset-x, 0px))' : 'none';

  // Pokretanje drag-and-drop akcije na levi klik miša
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canEdit || b.isOptimistic || isDeleting) return;
    if (e.button !== 0) return; // Samo levi klik pokreće drag

    e.stopPropagation();

    setDragging({
      bookingId: b.id,
      apartmentId: b.apartmentId,
      startX: e.clientX,
      originalStart: parseDateStr(b.start),
      originalEnd: parseDateStr(b.end),
    });
  };

  // Rukovanje desnim klikom (Context Menu) za brisanje
  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canEdit || isDeleting) return;
    e.preventDefault();
    const hasConfirmation = window.confirm(
      `Da li ste sigurni da želite da obrišete rezervaciju za gosta "${b.guest}"?`,
    );
    if (hasConfirmation) {
      deleteBooking(b.id);
    }
  };

  if (isDrag) {
    console.log(`[BAR DIAGNOSTICS] ID: ${b.id}`, {
      isDrag,
      dragValid,
      classNameHasInvalid: !dragValid ? 'DA' : 'NE',
    });
  }

  return (
    <div
      id={`bkg-bar-${b.id}`}
      className={[
        'booking',
        `booking-bar ${isHovered ? 'hovered' : ''}`,
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
        transform,
        zIndex: isDrag ? 1000 : isHovered ? 100 : 10,
        transition: isDrag ? 'none' : 'transform 0.15s ease-out, opacity 0.2s',
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => !isDeleting && setHoveredId(b.id)}
      onMouseLeave={() => setHoveredId(null)}
      onContextMenu={handleContextMenu}
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
          onMouseDown={(e) => e.stopPropagation()} // Sprečavamo da klik na X pokrene drag
          onClick={(e) => {
            e.stopPropagation();
            const hasConfirmation = window.confirm(
              `Da li ste sigurni da želite da obrišete rezervaciju za gosta "${b.guest}"?`,
            );
            if (hasConfirmation) {
              deleteBooking(b.id);
            }
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
};

// =============================================================================
// 🧠 PAMETNI REACT MEMO ZA COIL-PROOF PERFORMANSE
// =============================================================================
export const BookingBar = memo(BookingBarComponent, (prevProps, nextProps) => {
  // 🚨 KLJUČNA POPRAVKA ZA BUG-03: Ako se menja stanje drag-a ili validnosti, FORCE RENDER!
  if (prevProps.isDrag !== nextProps.isDrag) return false;
  if (prevProps.dragValid !== nextProps.dragValid) return false;
  if (prevProps.isHovered !== nextProps.isHovered) return false;
  if (prevProps.isDeleting !== nextProps.isDeleting) return false;
  if (prevProps.showGuestDetails !== nextProps.showGuestDetails) return false;

  // Za sve ostale statične trake, uporedi duboke pozicije i podatke
  return (
    prevProps.b.id === nextProps.b.id &&
    prevProps.b.start === nextProps.b.start &&
    prevProps.b.end === nextProps.b.end &&
    prevProps.b.guest === nextProps.b.guest &&
    prevProps.b.isOptimistic === nextProps.b.isOptimistic &&
    prevProps.styleCache?.left === nextProps.styleCache?.left &&
    prevProps.styleCache?.width === nextProps.styleCache?.width
  );
});

BookingBar.displayName = 'BookingBar';
