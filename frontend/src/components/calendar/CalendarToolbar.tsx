// =============================================================================
// 🎛️  frontend/src/components/calendar/CalendarToolbar.tsx
// =============================================================================
//
// Toolbar sa navigacijom po datumima, statistikama i role badge/login dugmetom.
//
// Izdvojen iz BookingCalendar.tsx radi:
//   - Jasne odgovornosti (SRP)
//   - Lakšeg testiranja navigacione logike
//   - Mogućnosti da se toolbar zameni (npr. mobilna verzija)
// =============================================================================

import { addMonths, addWeeks, startOfDay } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import type { AuthUser } from '../../../../shared/index';
import type { Stats } from '../../types/ui';
import { fmtMonthYear } from '../../utils/dates';

// =============================================================================
// 📊 StatPill — mala statistička "pilula"
// =============================================================================

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-pill">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

// =============================================================================
// 🎛️  PROPS
// =============================================================================

interface CalendarToolbarProps {
  startDate: Date;
  setStartDate: React.Dispatch<React.SetStateAction<Date>>;
  stats: Stats;
  currentUser: AuthUser | null;
  isAdmin: boolean;
  isViewer: boolean;
  canEdit: boolean;
  onLogout: () => void;
}

// =============================================================================
// 🎛️  KOMPONENTA
// =============================================================================

export function CalendarToolbar({
  startDate,
  setStartDate,
  stats,
  currentUser,
  isAdmin,
  isViewer,
  canEdit,
  onLogout,
}: CalendarToolbarProps) {
  const navigate = useNavigate();

  const hintText = canEdit
    ? 'Prevuci za pomeranje · Desni klik za brisanje'
    : isViewer
      ? 'Klikni slobodne datume za zahtev rezervacije'
      : 'Klikni za zahtev · Prijavite se za više opcija';

  return (
    <div className="toolbar">
      {/* ── Navigacija ─────────────────────────────────────────────────── */}
      <button
        className="btn"
        onClick={() => setStartDate((d) => addMonths(d, -1))}
        title="Prethodni mesec"
      >
        ← Mesec
      </button>
      <button
        className="btn"
        onClick={() => setStartDate((d) => addWeeks(d, -1))}
        title="Prethodna nedelja"
      >
        ← Nedelja
      </button>

      <span className="month-label">{fmtMonthYear(startDate)}</span>

      <button
        className="btn"
        onClick={() => setStartDate((d) => addWeeks(d, 1))}
        title="Sledeća nedelja"
      >
        Nedelja →
      </button>
      <button
        className="btn"
        onClick={() => setStartDate((d) => addMonths(d, 1))}
        title="Sledeći mesec"
      >
        Mesec →
      </button>
      <button className="btn" onClick={() => setStartDate(startOfDay(new Date()))}>
        Danas
      </button>

      {/* ── Desna strana ─────────────────────────────────────────────── */}
      <div className="toolbar-right">
        <StatPill label="Rezervacije" value={stats.count ?? 0} />
        <StatPill label="Popunjenost" value={`${stats.occupancy ?? 0}%`} />

        <span className="toolbar-hint">{hintText}</span>

        {/* Role badge */}
        {currentUser && (
          <span className="role-badge" data-role={currentUser.role}>
            {isAdmin ? '🔑 Admin' : '👁️ Viewer'}
          </span>
        )}

        {/* Login / Logout */}
        {currentUser ? (
          <button onClick={onLogout} className="btn btn-danger">
            Odjavi se 🚪
          </button>
        ) : (
          <button onClick={() => navigate('/login')} className="btn btn-primary">
            Prijava 🔐
          </button>
        )}
      </div>
    </div>
  );
}
