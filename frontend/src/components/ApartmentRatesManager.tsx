import React, { useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'react-hot-toast';
import { ApartmentRateData } from '../../../shared/index';
import { deleteApartmentRate, updateApartmentRate, createApartmentRate } from '../api/rates';
import { remoteLogger } from '../utils/remoteLogger';

interface ApartmentRatesManagerProps {
  apartmentId: string;
  apartmentName: string;
  existingRates: ApartmentRateData[];
  onRateAdded: () => void;
}

export default function ApartmentRatesManager({
  apartmentId,
  apartmentName,
  existingRates,
  onRateAdded,
}: ApartmentRatesManagerProps): React.JSX.Element {
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [price, setPrice] = useState<string>('');
  const [capacity, setCapacity] = useState<number>(2);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();

    if (!startDate || !endDate || !price) {
      toast.error('Sva polja su obavezna.');
      return;
    }

    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      toast.error('Cena mora biti validan pozitivan broj.');
      return;
    }

    try {
      setIsSubmitting(true);

      remoteLogger({
        level: 'info',
        message: `'💰 Pokretanje asinhronog unosa nove sezone`,
        errorDetails: { apartmentId, startDate, endDate, parsedPrice, capacity },
      });

      await createApartmentRate({
        apartmentId,
        startDate,
        endDate,
        price: parsedPrice,
        capacity,
      });

      toast.success('Sezonska cena uspešno dodata!');
      setStartDate('');
      setEndDate('');
      setPrice('');
      setCapacity(2);
      onRateAdded();
    } catch (err: unknown) {
      const error = err as Error;
      remoteLogger({
        level: 'error',
        message: `❌ Greška prilikom upisa nove sezone u bazu'`,
        errorDetails: {
          stack: error.stack,
          componentStack: apartmentId,
        },
      });

      toast.error(error.message || 'Greška pri čuvanju cene.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 🛡️ Tipski bezbedno grupisanje: Kreiramo niz jedinstvenih kapaciteta koji postoje u podacima
  // Sortiramo ih od najmanjeg ka najvećem (1 osoba, 2 osobe, 3 osobe...)
  const unikatniKapaciteti = Array.from(new Set(existingRates.map((r) => r.capacity ?? 2))).sort(
    (a, b) => a - b,
  );

  // =============================================================================
  // 💰 frontend/src/components/ApartmentRatesManager.tsx — DEO 2 od 2
  // =============================================================================
  return (
    <div
      style={{
        background: '#ffffff',
        padding: '24px',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        maxWidth: '800px',
        margin: '20px auto',
        fontFamily: 'sans-serif',
      }}
    >
      <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '16px', color: '#1f2937' }}>
        💰 Cenovnik i sezone za apartman: <span style={{ color: '#2563eb' }}>{apartmentName}</span>
      </h2>

      {/* 1. SEKCIJA: Lista grupisanih sezonskih cena */}
      <div style={{ marginBottom: '32px' }}>
        <h3
          style={{
            fontSize: '15px',
            fontWeight: 600,
            color: '#374151',
            marginBottom: '16px',
            borderBottom: '2px solid #f3f4f6',
            paddingBottom: '8px',
          }}
        >
          Aktivni sezonski opsezi (Grupisano prema broju gostiju):
        </h3>

        {existingRates.length === 0 ? (
          <p style={{ fontSize: '13px', color: '#9ca3af', fontStyle: 'italic' }}>
            Nema konfigurisanih sezonskih cena. Koristi se podrazumevani cenovnik.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {unikatniKapaciteti.map((trenutniKapacitet) => {
              const ceneZaKapacitet = existingRates.filter(
                (r) => (r.capacity ?? 2) === trenutniKapacitet,
              );
              const oznakaGostiju =
                trenutniKapacitet === 1 ? 'osobu' : trenutniKapacitet < 5 ? 'osobe' : 'osoba';

              return (
                <div
                  key={trenutniKapacitet}
                  style={{
                    background: '#f8fafc',
                    padding: '16px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '12px',
                    }}
                  >
                    <span style={{ fontSize: '16px' }}>👤</span>
                    <h4
                      style={{
                        margin: 0,
                        fontSize: '14px',
                        fontWeight: 700,
                        color: '#1e293b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      Cene za {trenutniKapacitet} {oznakaGostiju}
                    </h4>
                    <span
                      style={{
                        background: '#3b82f6',
                        color: '#fff',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        padding: '2px 6px',
                        borderRadius: '10px',
                      }}
                    >
                      {ceneZaKapacitet.length}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {ceneZaKapacitet.map((rate: ApartmentRateData) => (
                      <div
                        key={rate.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '10px 14px',
                          background: '#ffffff',
                          borderRadius: '6px',
                          border: '1px solid #e2e8f0',
                          fontSize: '13px',
                        }}
                      >
                        <div>
                          📅 <strong>{format(new Date(rate.startDate), 'dd.MM.yyyy')}</strong> do{' '}
                          <strong>{format(new Date(rate.endDate), 'dd.MM.yyyy')}</strong>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <span style={{ fontWeight: 'bold', color: '#059669', fontSize: '14px' }}>
                            {Number(rate.price).toFixed(2)} € / noć
                          </span>

                          <button
                            type="button"
                            onClick={async (): Promise<void> => {
                              const trenutnaCena = rate.price.toString();
                              const novaCenaStr = window.prompt(
                                'Unesite novu cenu (€/noć):',
                                trenutnaCena,
                              );

                              if (novaCenaStr !== null) {
                                const novaCena = parseFloat(novaCenaStr);
                                if (isNaN(novaCena) || novaCena <= 0) {
                                  toast.error('Molimo unesite validan pozitivan broj.');
                                  return;
                                }
                                try {
                                  await updateApartmentRate(rate.id, novaCena);
                                  toast.success('Cena uspešno izmenjena!');
                                  onRateAdded();
                                } catch (err: unknown) {
                                  toast.error((err as Error).message);
                                }
                              }
                            }}
                            style={{
                              background: '#e0f2fe',
                              color: '#0369a1',
                              border: 'none',
                              borderRadius: '4px',
                              width: '24px',
                              height: '24px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '12px',
                            }}
                            title="Izmeni cenu"
                          >
                            ✏️
                          </button>

                          <button
                            type="button"
                            onClick={async (): Promise<void> => {
                              if (
                                window.confirm(
                                  'Da li ste sigurni da želite da obrišete ovaj cenovnik?',
                                )
                              ) {
                                try {
                                  await deleteApartmentRate(rate.id);
                                  toast.success('Sezonska cena uspešno obrisana.');
                                  onRateAdded();
                                } catch (err: unknown) {
                                  toast.error((err as Error).message);
                                }
                              }
                            }}
                            style={{
                              background: '#fee2e2',
                              color: '#dc2626',
                              border: 'none',
                              borderRadius: '4px',
                              width: '24px',
                              height: '24px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 'bold',
                              fontSize: '12px',
                            }}
                            title="Obriši sezonsku cenu"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', marginBottom: '20px' }} />

      {/* 2. SEKCIJA: Forma za dodavanje nove sezonske cene */}
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
      >
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#4b5563' }}>
          Dodaj novi sezonski opseg:
        </h3>

        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: '#374151' }}>
              Početak sezone
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartDate(e.target.value)}
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
          </div>

          <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: '#374151' }}>
              Kraj sezone
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEndDate(e.target.value)}
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
          </div>

          <div style={{ flex: '1 1 120px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: '#374151' }}>
              Cena po noćenju (€)
            </label>
            <input
              type="number"
              placeholder="npr. 85"
              value={price}
              min="1"
              onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
                const val = e.target.value;
                if (val === '' || parseFloat(val) >= 0) setPrice(val);
              }}
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
          </div>

          <div style={{ flex: '1 1 120px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 500, color: '#374151' }}>
              Maks. kapacitet
            </label>
            <select
              value={capacity}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>): void =>
                setCapacity(Number(e.target.value))
              }
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                backgroundColor: '#ffffff',
                height: '38px',
              }}
            >
              <option value={1}>1 osoba</option>
              <option value={2}>2 osobe</option>
              <option value={3}>3 osobe</option>
              <option value={4}>4 osobe</option>
              <option value={5}>5 osoba</option>
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            alignSelf: 'flex-start',
            padding: '10px 20px',
            background: isSubmitting ? '#9ca3af' : '#2563eb',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          }}
        >
          {isSubmitting ? 'Čuvanje...' : 'Sačuvaj sezonsku cenu'}
        </button>
      </form>
    </div>
  );
}
