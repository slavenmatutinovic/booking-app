import { useEffect, useState } from 'react';
import { getPendingRequests, approveBookingRequest, rejectBookingRequest } from '../api/bookings';
import { fmtShort } from '../utils/dates';
import { ApiReservationRequest } from '../types/ui';

export function AdminDashboard() {
  const [requests, setRequests] = useState<ApiReservationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const REFRESH_INTERVAL_MS = 30_000; // Osvežava svakih 30 sekundi

  useEffect(() => {
    let active = true;

    async function synchronizeData() {
      try {
        const data = await getPendingRequests();
        if (!active) return;
        setRequests(data);
        setLastRefresh(new Date());
        setError(null); // Completely valid asynchronous execution path
      } catch (err: unknown) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : 'Greška pri učitavanju zahteva.';
        setError(msg);
      } finally {
        if (active) setLoading(false);
      }
    }

    // Trigger the initial mount execution pipeline immediately
    synchronizeData();

    // Establish the background background tracking interval sequence
    const intervalId = setInterval(() => {
      synchronizeData();
    }, REFRESH_INTERVAL_MS);

    // Structural cleanup phase completely stops trace execution leaks if the admin switches tabs
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, []); // 📊 Array stays dead empty since the logic uses local encapsulated closures
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
  const handleReject = async (id: string) => {
    if (processingId) return;
    if (
      !confirm(
        'Da li ste sigurni da želite da odbijete ovaj zahtev? Gost će biti obavešten emailom.',
      )
    )
      return;
    try {
      setProcessingId(`reject-${id}`);
      await rejectBookingRequest(id);
      setRequests((prev) => prev.filter((req) => req.id !== id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Neuspešno odbijanje zahteva.';
      alert(`⚠️ Greška: ${msg}`);
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) return <div className="p-4 text-center">Učitavanje zahteva na čekanju...</div>;
  if (error) return <div className="p-4 text-red-500">Greška: {error}</div>;

  return (
    <div className="admin-dashboard-container" style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <h2 style={{ marginBottom: 20, color: '#111827' }}>📬 Zahtevi za rezervaciju na čekanju</h2>
        {/* 🚀 SADA SE KORISTI: Ispisujemo tačno vreme poslednjeg auto-osvežavanja */}
        <span style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>
          Poslednje osvežavanje: {lastRefresh.toLocaleTimeString()}
        </span>
      </div>
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
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    {/* Odobri dugme */}

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
                    {/* [BUG-03 POPRAVKA] Odbij dugme — novo! */}
                    <button
                      onClick={() => handleReject(req.id)}
                      disabled={!!processingId}
                      title="Odbij zahtev i obavesti gosta emailom"
                      style={{
                        background: processingId === `reject-${req.id}` ? '#fef2f2' : '#fff',
                        color: processingId === `reject-${req.id}` ? '#991b1b' : '#dc2626',
                        border: '1.5px solid #fca5a5',
                        padding: '6px 14px',
                        borderRadius: 6,
                        cursor: processingId ? 'not-allowed' : 'pointer',
                        fontWeight: 500,
                        fontSize: 13,
                        transition: 'all 0.2s',
                        opacity: !!processingId && processingId !== `reject-${req.id}` ? 0.6 : 1,
                      }}
                    >
                      {processingId === `reject-${req.id}` ? 'Odbijam...' : '✕ Odbij'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
