// frontend/src/components/PendingBadge.tsx

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPendingRequestsCount } from '../api/bookings';

interface PendingBadgeProps {
  isAdmin: boolean;
}

export function PendingBadge({ isAdmin }: PendingBadgeProps) {
  const [count, setCount] = useState<number>(0);
  const navigate = useNavigate();
  const POLL_INTERVAL_MS = 60_000;

  // 🚀 JEDINI I ČISTI EFFECT: Samo sinhronizuje broj sa serverom asinhrono
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;

    async function synchronizeCount() {
      try {
        const newCount = await getPendingRequestsCount();
        if (!active) return;
        setCount(newCount);
      } catch {
        // Tiha greška
      }
    }

    synchronizeCount();

    const interval = setInterval(synchronizeCount, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isAdmin]);

  if (!isAdmin) return null;

  return (
    <>
      {/* 🚀 REŠENJE ZA ANIMACIJU: Ubacujemo čist CSS stil direktno u fajl */}
      <style>{`
        @keyframes badgePulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
        .pulse-badge-animation {
          animation: badgePulse 0.4s ease-in-out;
        }
      `}</style>

      <button
        // 🚀 GENIJALAN REKT TRIK: Svaki put kada se 'count' promeni, promeniće se i 'key'.
        // To prisiljava browser da ponovo pokrene gornju .pulse-badge-animation CSS animaciju!
        key={count}
        onClick={() => navigate('/admin/requests')}
        className={count > 0 ? 'pulse-badge-animation' : ''}
        title={
          count > 0
            ? `${count} zahtev${count === 1 ? '' : 'a'} čeka odobrenje`
            : 'Zahtevi za rezervaciju'
        }
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: count > 0 ? '#fef2f2' : '#f3f4f6',
          border: `1px solid ${count > 0 ? '#fecaca' : '#d1d5db'}`,
          borderRadius: 20,
          padding: '5px 12px',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 500,
          color: count > 0 ? '#dc2626' : '#6b7280',
          transition: 'all 0.2s',
        }}
      >
        📬 Zahtevi
        {count > 0 && (
          <span
            style={{
              background: '#ef4444',
              color: '#fff',
              borderRadius: 20,
              padding: '1px 7px',
              fontSize: 12,
              fontWeight: 700,
              minWidth: 18,
              textAlign: 'center',
            }}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
    </>
  );
}
