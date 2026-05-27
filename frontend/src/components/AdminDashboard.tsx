import { useEffect, useState } from 'react';
import { getPendingRequests, approveBookingRequest } from '../api/bookings';
import { fmtShort } from '../utils/dates';
import { ApiReservationRequest } from '../types/ui';

export function AdminDashboard() {
  const [requests, setRequests] = useState<ApiReservationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // 🚀 FIXED: The async operation is contained strictly inside the effect boundary
  useEffect(() => {
    let active = true;

    async function startFetching() {
      try {
        const data = await getPendingRequests();
        if (!active) return;
        setRequests(data);
      } catch (err: unknown) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : 'Greška pri učitavanju zahteva.';
        setError(msg);
      } finally {
        if (active) setLoading(false);
      }
    }

    startFetching();

    // Cleanup phase prevents memory leaks and stale mutations
    return () => {
      active = false;
    };
  }, []); // 📊 Triggers strictly once upon mounting

  // ── Handler za odobravanje klikom na dugme ───────────────────────────────
  const handleApprove = async (id: string) => {
    if (processingId) return;
    try {
      setProcessingId(id);
      await approveBookingRequest(id);
      alert('✅ Zahtev je uspešno odobren i ubačen u kalendar!');
      setRequests((prev) => prev.filter((req) => req.id !== id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Neuspešno odobravanje zahteva.';
      alert(`⚠️ Greška: ${msg}`);
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) return <div className="p-4 text-center">Učitavanje zahteva na čekanju...</div>;
  if (error) return <div className="p-4 text-red-500">Greška: {error}</div>;

  return (
    <div className="admin-dashboard-container" style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h2 style={{ marginBottom: 20, color: '#111827' }}>📬 Zahtevi za rezervaciju na čekanju</h2>

      {requests.length === 0 ? (
        <div style={{ color: '#6b7280', fontStyle: 'italic' }}>
          Trenutno nema novih zahteva na čekanju.
        </div>
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            background: '#fff',
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <thead>
            <tr
              style={{
                background: '#f3f4f6',
                textAlign: 'left',
                fontSize: 13,
                color: '#374151',
                textTransform: 'uppercase',
              }}
            >
              <th style={{ padding: 12 }}>Apartman</th>
              <th style={{ padding: 12 }}>Gost</th>
              <th style={{ padding: 12 }}>Kontakti</th>
              <th style={{ padding: 12 }}>Period</th>
              <th style={{ padding: 12, textAlign: 'center' }}>Akcija</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((req) => (
              <tr
                key={req.id}
                style={{ borderBottom: '1px solid #e5e7eb', fontSize: 14, color: '#4b5563' }}
              >
                <td style={{ padding: 12, fontWeight: 600, color: '#111827' }}>
                  {req.apartment?.name}
                </td>
                <td style={{ padding: 12 }}>{req.guest}</td>
                <td style={{ padding: 12 }}>
                  <div>{req.email}</div>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>
                    {req.phone || 'Nema telefona'}
                  </div>
                </td>
                <td style={{ padding: 12, fontWeight: 500 }}>
                  {fmtShort(new Date(req.startDate))} {' → '} {fmtShort(new Date(req.endDate))}
                </td>
                <td style={{ padding: 12, textAlign: 'center' }}>
                  <button
                    onClick={() => handleApprove(req.id)}
                    disabled={processingId === req.id}
                    style={{
                      background: '#10b981',
                      color: '#fff',
                      border: 'none',
                      padding: '6px 14px',
                      borderRadius: 6,
                      cursor: processingId === req.id ? 'not-allowed' : 'pointer',
                      fontWeight: 500,
                      transition: 'background 0.2s',
                    }}
                  >
                    {processingId === req.id ? 'Odobravanje...' : 'Odobri ✓'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
