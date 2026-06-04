import React, { useState } from 'react';
import { format } from 'date-fns';
import { ApartmentRateData } from '../../../shared/index';
import { deleteApartmentRate, updateApartmentRate, createApartmentRate } from '../api/rates';

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
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!startDate || !endDate || !price) {
      setErrorMessage('Sva polja su obavezna.');
      return;
    }

    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      setErrorMessage('Cena mora biti validan pozitivan broj.');
      return;
    }

    try {
      setIsSubmitting(true);
      // Ovde pozivaš tvoj API za kreiranje (npr. createApartmentRate)

      // Pozivamo našu osveženu funkciju bez ISO pomeranja vremenskih zona
      await createApartmentRate({
        apartmentId: apartmentId, // Eksplicitno dodeljivanje vrednosti iz propsa komponente
        startDate: startDate,
        endDate: endDate,
        price: parsedPrice,
      });

      setSuccessMessage('Sezonska cena uspešno dodata!');
      setStartDate('');
      setEndDate('');
      setPrice('');
      onRateAdded();
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(error.message || 'Greška pri čuvanju cene.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        background: '#ffffff',
        padding: '24px',
        borderRadius: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        maxWidth: '800px',
        margin: '20px auto',
      }}
    >
      <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '16px', color: '#1f2937' }}>
        💰 Cenovnik i sezone za apartman: <span style={{ color: '#2563eb' }}>{apartmentName}</span>
      </h2>

      {/* 1. Lista trenutno aktivnih sezonskih cena */}
      <div style={{ marginBottom: '24px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#4b5563', marginBottom: '8px' }}>
          Trenutno aktivni sezonski opsezi:
        </h3>
        {existingRates.length === 0 ? (
          <p style={{ fontSize: '13px', color: '#9ca3af', fontStyle: 'italic' }}>
            Nema konfigurisanih sezonskih cena. Koristi se podrazumevani cenovnik.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {existingRates.map((rate: ApartmentRateData) => (
              <div
                key={rate.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 14px',
                  background: '#f9fafb',
                  borderRadius: '6px',
                  border: '1px solid #e5e7eb',
                  fontSize: '13px',
                }}
              >
                <div>
                  📅 <strong>{format(new Date(rate.startDate), 'dd.MM.yyyy')}</strong> do{' '}
                  <strong>{format(new Date(rate.endDate), 'dd.MM.yyyy')}</strong>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontWeight: 'bold', color: '#059669' }}>
                    {Number(rate.price).toFixed(2)} € / noć
                  </span>

                  {/* ✏️ Dugme za IZMENU postojeće sezone */}
                  <button
                    type="button"
                    onClick={async (): Promise<void> => {
                      const trenutnaCena: string = rate.price.toString();
                      const novaCenaStr: string | null = window.prompt(
                        'Unesite novu cenu (€/noć):',
                        trenutnaCena,
                      );

                      if (novaCenaStr !== null) {
                        const novaCena: number = parseFloat(novaCenaStr);
                        if (isNaN(novaCena) || novaCena <= 0) {
                          alert('Molimo unesite validan pozitivan broj.');
                          return;
                        }
                        try {
                          await updateApartmentRate(rate.id, novaCena);
                          onRateAdded();
                        } catch (err: unknown) {
                          const error = err as Error;
                          alert(error.message);
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

                  {/* ✕ Dugme za BRISANJE postojeće sezone */}
                  <button
                    type="button"
                    onClick={async (): Promise<void> => {
                      if (
                        window.confirm('Da li ste sigurni da želite da obrišete ovaj cenovnik?')
                      ) {
                        try {
                          await deleteApartmentRate(rate.id);
                          onRateAdded();
                        } catch (err: unknown) {
                          const error = err as Error;
                          alert(error.message);
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
                      transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) =>
                      (e.currentTarget.style.background = '#fca5a5')
                    }
                    onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) =>
                      (e.currentTarget.style.background = '#fee2e2')
                    }
                    title="Obriši sezonsku cenu"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', marginBottom: '20px' }} />

      {/* 2. Forma za dodavanje nove sezonske cene */}
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

          <div style={{ flex: '1 1 150px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
                if (val === '' || parseFloat(val) >= 0) {
                  setPrice(val);
                }
              }}
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
          </div>
        </div>

        {errorMessage && (
          <div
            style={{
              color: '#b91c1c',
              background: '#fee2e2',
              padding: '10px',
              borderRadius: '6px',
              fontSize: '13px',
            }}
          >
            ⚠️ {errorMessage}
          </div>
        )}
        {successMessage && (
          <div
            style={{
              color: '#047857',
              background: '#d1fae5',
              padding: '10px',
              borderRadius: '6px',
              fontSize: '13px',
            }}
          >
            ✅ {successMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            alignSelf: 'flex-start',
            backgroundColor: isSubmitting ? '#9ca3af' : '#2563eb',
            color: '#ffffff',
            padding: '10px 20px',
            border: 0,
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: 500,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.2s',
          }}
        >
          {isSubmitting ? 'Čuvanje...' : 'Sačuvaj sezonsku cenu'}
        </button>
      </form>
    </div>
  );
}
