import { useMemo } from 'react';
import { calculateClientDynamicPrice } from '../utils/pricingCalculator';
import { format } from 'date-fns';
import { ApartmentRateData } from '../../../shared';

interface BookingPricePreviewProps {
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  activeRates: ApartmentRateData[];
  capacity: number;
}

export function BookingPricePreview({
  startDate,
  endDate,
  activeRates,
  capacity,
}: BookingPricePreviewProps) {
  // Memoize calculation loops to prevent unnecessary recalibration during re-renders
  const priceCalculation = useMemo(() => {
    if (!startDate || !endDate) return null;
    return calculateClientDynamicPrice(startDate, endDate, activeRates, 0.0, capacity);
  }, [startDate, endDate, activeRates, capacity]);

  if (!priceCalculation || priceCalculation.totalNights === 0) {
    return null;
  }

  return (
    <div
      style={{
        background: '#f8fafc',
        padding: '16px',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        marginTop: '16px',
        fontSize: '14px',
      }}
    >
      <h3 style={{ fontWeight: 600, color: '#334155', marginBottom: '12px', fontSize: '15px' }}>
        🧮 Detaljan obračun cene boravka:
      </h3>

      {/* 1. Itemized Day-by-Day Dynamic Cost Matrix */}
      <div
        style={{
          maxHeight: '150px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          paddingRight: '4px',
          marginBottom: '12px',
        }}
      >
        {priceCalculation.breakdown.map((item, index) => (
          <div
            key={index}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              color: '#475569',
              fontSize: '13px',
              borderBottom: '1px dashed #e2e8f0',
              paddingBottom: '4px',
            }}
          >
            <span>
              Noćenje {index + 1}: ({format(new Date(item.dateStr), 'dd.MM.yyyy')})
            </span>

            <span style={{ fontWeight: 500, color: item.price === 0 ? '#ef4444' : '#475569' }}>
              {item.price === 0 ? 'Nema konfigurisanu cenu' : `${item.price.toFixed(2)} €`}
            </span>
          </div>
        ))}
      </div>

      {/* 2. Totalized Aggregate Summary Blocks */}
      <div
        style={{
          background: '#ffffff',
          padding: '12px',
          borderRadius: '6px',
          border: '1px solid #cbd5e1',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '4px',
            color: '#64748b',
            fontSize: '13px',
          }}
        >
          <span>Ukupno noćenja:</span>
          <span>{priceCalculation.totalNights}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '8px',
            color: '#64748b',
            fontSize: '13px',
          }}
        >
          <span>Prosečna cena po noći:</span>
          <span>{priceCalculation.averagePricePerNight.toFixed(2)} €</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontWeight: 'bold',
            fontSize: '16px',
            color: '#1e3a8a',
            paddingTop: '6px',
            borderTop: '1px solid #cbd5e1',
          }}
        >
          <span>UKUPNA CENA:</span>
          <span>{priceCalculation.totalPrice.toFixed(2)} €</span>
        </div>
      </div>
    </div>
  );
}
