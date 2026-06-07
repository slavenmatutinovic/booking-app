// =============================================================================
// 💰 frontend/src/components/AdminRatesPage.tsx (Bulletproof Array Safe Fix)
// =============================================================================
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiFetch from '../api';
import ApartmentRatesManager from './ApartmentRatesManager';

interface Apartment {
  id: string;
  name: string;
  description?: string;
}

interface ApartmentRateData {
  id: string;
  apartmentId: string;
  startDate: string;
  endDate: string;
  price: number;
  capacity: number;
}

interface RatesApiResponse {
  rates: ApartmentRateData[];
}

export function AdminRatesPage(): React.JSX.Element {
  // 🛡️ Guard state initialization to always enforce empty array arrays
  const [apartments, setApartments] = useState<Apartment[]>([]);
  const [selectedApartmentId, setSelectedApartmentId] = useState<string>('');
  const [rates, setRates] = useState<ApartmentRateData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // 1. Load apartment units safely
  useEffect(() => {
    async function loadApartments(): Promise<void> {
      try {
        const response = await apiFetch('apartments');
        if (!response.ok) {
          throw new Error('Neuspešno učitavanje liste apartmana.');
        }

        const rawData = await response.json();
        let extractedArray: Apartment[] = [];

        // 🛡️ Deep scan payload to pull an array regardless of structure
        if (Array.isArray(rawData)) {
          extractedArray = rawData as Apartment[];
        } else if (rawData && typeof rawData === 'object') {
          const envelope = rawData as Record<string, unknown>;

          if (Array.isArray(envelope.apartments)) {
            extractedArray = envelope.apartments as Apartment[];
          } else if (Array.isArray(envelope.data)) {
            extractedArray = envelope.data as Apartment[];
          } else if (Array.isArray(envelope.result)) {
            extractedArray = envelope.result as Apartment[];
          }
        }

        // Final verification check before updating React state
        if (Array.isArray(extractedArray)) {
          setApartments(extractedArray);
          if (extractedArray.length > 0) {
            // ✅ FIX: Access the first index item property safely
            setSelectedApartmentId(extractedArray[0].id);
          } else {
            setError('Nema dostupnih apartmana u sistemu.');
          }
        } else {
          setApartments([]);
          setError('Format podataka sa servera je neispravan.');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Došlo je do neočekivane greške.';
        setError(msg);
      } finally {
        setLoading(false);
      }
    }
    loadApartments();
  }, []);

  // 2. Fetch rates reactively when selectedApartmentId changes
  useEffect(() => {
    if (!selectedApartmentId) return;

    let isMounted = true;

    async function fetchRates(): Promise<void> {
      try {
        const response = await apiFetch(`apartments/${selectedApartmentId}/rates`);
        if (!response.ok) {
          throw new Error('Neuspešno učitavanje sezonskih cena.');
        }
        const data = (await response.json()) as RatesApiResponse;

        if (isMounted) {
          setRates(data.rates || []);
        }
      } catch (err: unknown) {
        if (isMounted) {
          const msg = err instanceof Error ? err.message : 'Greška pri osvežavanju cena.';
          alert(`⚠️ ${msg}`);
        }
      }
    }

    fetchRates();

    return () => {
      isMounted = false;
    };
  }, [selectedApartmentId]);

  // 3. Manual refresh action passed to rates manager component
  const handleRateAdded = React.useCallback(async (): Promise<void> => {
    if (!selectedApartmentId) return;
    try {
      const response = await apiFetch(`apartments/${selectedApartmentId}/rates`);
      if (response.ok) {
        const data = (await response.json()) as RatesApiResponse;
        setRates(data.rates || []);
      }
    } catch (err: unknown) {
      console.error('Greška pri osvežavanju nakon unosa:', err);
    }
  }, [selectedApartmentId]);

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', fontFamily: 'sans-serif' }}>
        Učitavanje konfiguracije sistema...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: '#dc2626', fontFamily: 'sans-serif' }}>Greška: {error}</div>
    );
  }

  // 🛡️ ABSOLUTE COMPONENT SAFEGUARD: Local execution arrays
  const cleanApartmentsList: Apartment[] = Array.isArray(apartments) ? apartments : [];
  const currentApartment = cleanApartmentsList.find((a) => a.id === selectedApartmentId);

  return (
    <div
      style={{
        padding: 24,
        fontFamily: 'sans-serif',
        backgroundColor: '#f8f9fa',
        minHeight: '100vh',
      }}
    >
      {/* Top Banner Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#fff',
          padding: '16px 24px',
          borderRadius: 8,
          marginBottom: 24,
          border: '1px solid #e5e7eb',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div>
          <h2 style={{ margin: 0, color: '#111827', fontSize: '20px', fontWeight: 'bold' }}>
            💰 Upravljanje Sezonskim Cenovnicima
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#6b7280' }}>
            Konfiguracija cena i restrikcija kapaciteta gostiju.
          </p>
        </div>
        <Link
          to="/calendar"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            backgroundColor: '#3b82f6',
            color: '#ffffff',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '13px',
            padding: '8px 16px',
            borderRadius: 6,
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
          }}
        >
          📅 Nazad na Kalendar
        </Link>
      </div>

      {/* Selector dropdown menu */}
      <div
        style={{
          background: '#fff',
          padding: '16px 24px',
          borderRadius: 8,
          marginBottom: 24,
          border: '1px solid #e5e7eb',
        }}
      >
        <label
          style={{
            display: 'block',
            fontSize: '13px',
            fontWeight: 500,
            color: '#374151',
            marginBottom: '8px',
          }}
        >
          Izaberite stan/apartman:
        </label>
        <select
          value={selectedApartmentId}
          onChange={(e) => setSelectedApartmentId(e.target.value)}
          style={{
            width: '100%',
            maxWidth: '300px',
            padding: '10px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '14px',
            backgroundColor: '#fff',
          }}
        >
          {cleanApartmentsList.map((apt) => (
            <option key={apt.id} value={apt.id}>
              {apt.name}
            </option>
          ))}
        </select>
      </div>

      {/* Main Rates management dashboard segment */}
      {selectedApartmentId && currentApartment ? (
        <ApartmentRatesManager
          apartmentId={selectedApartmentId}
          apartmentName={currentApartment.name}
          existingRates={rates}
          onRateAdded={handleRateAdded}
        />
      ) : (
        <div style={{ padding: 16, color: '#6b7280' }}>
          Nije pronađen izabrani apartman. Ukoliko se lista ne prikazuje, proverite API odgovor.
        </div>
      )}
    </div>
  );
}
