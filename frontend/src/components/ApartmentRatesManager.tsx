import React, { useState } from 'react';
import { createApartmentRate } from '../api/rates';
import { ApartmentRateData } from '../../../shared/index';

import { format } from 'date-fns';

interface ApartmentRatesManagerProps {
  apartmentId: string;
  apartmentName: string;
  existingRates: ApartmentRateData[];
  onRateAdded: () => void; // Reloads global page content cleanly upon creation
}

export function ApartmentRatesManager({
  apartmentId,
  apartmentName,
  existingRates,
  onRateAdded,
}: ApartmentRatesManagerProps) {
  // Local Form Input States
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [price, setPrice] = useState('');

  // Status Tracker States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate || !price) {
      setErrorMessage('Sva polja su obavezna.');
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      await createApartmentRate({
        apartmentId,
        startDate,
        endDate,
        price: Number(price),
      });

      setSuccessMessage('Sezonski cenovnik uspešno sačuvan!');
      setStartDate('');
      setEndDate('');
      setPrice('');

      // Trigger context updates up the layout tree
      onRateAdded();
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(error.message || 'Sistemska greška tokom slanja podataka.');
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

      {/* 1. Itemized Active Rates Summary Track List */}
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
            {existingRates.map((rate) => (
              <div
                key={rate.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
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
                <div style={{ fontWeight: 'bold', color: '#059669' }}>
                  {Number(rate.price).toFixed(2)} € / noć
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <hr style={{ border: 0, borderTop: '1px solid #e5e7eb', marginBottom: '20px' }} />

      {/* 2. Management Input Provisioning Form Layout */}
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
              onChange={(e) => setStartDate(e.target.value)}
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
              onChange={(e) => setEndDate(e.target.value)}
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
              onChange={(e) => setPrice(e.target.value)}
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            />
          </div>
        </div>

        {/* System Feedback Messages */}
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
