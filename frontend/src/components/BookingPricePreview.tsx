import { useMemo } from 'react';
import { calculateStayPriceShared } from '../../../shared/pricing';
import { format } from 'date-fns';
import { ApartmentRateData } from '../../../shared';
import { parseDateStr } from '../utils/dates';

interface BookingPricePreviewProps {
  activeRates: ApartmentRateData[];
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  capacity: number;
}

export function BookingPricePreview({
  startDate,
  endDate,
  activeRates,
  capacity,
}: BookingPricePreviewProps) {
  // Memoize calculation loops to prevent unnecessary recalibration during re-renders
  // 🎯 JEDINSTVENI MEMO: Čist, bez redundantnih zavisnosti i bez skrivanja fatalnih grešaka
  const priceCalculation = useMemo(() => {
    if (!startDate || !endDate) return null;

    const start = parseDateStr(startDate);
    const end = parseDateStr(endDate);
    const totalNights = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));

    if (totalNights <= 0) return null;

    try {
      // Pozivamo tvoj shared kod – ako fali cena, ovde momentalno puca izvršavanje!
      // 🔥 NEMA DUPLIRANJA LOGIKE: Prosleđujemo true i dobijamo kompletan breakdown iz shared-a
      const result = calculateStayPriceShared({
        rates: activeRates,
        startDateInput: startDate,
        totalNights,
        bookingCapacity: capacity,
        returnBreakdown: true,
      }) as {
        totalPrice: number;
        averagePricePerNight: number;
        breakdown: { dateStr: string; price: number }[];
      };

      return { ...result, totalNights, error: null };
    } catch (err: unknown) {
      // ✅  Hvata se stroga poruka i čuva se broj noćenja kako komponenta ne bi nestala
      const msg = err instanceof Error ? err.message : 'Greška pri računanju cene.';
      return {
        totalPrice: 0,
        totalNights, // Čuvamo broj noćenja da bi barijera propustila render greške
        averagePricePerNight: 0,
        breakdown: [], // Prazan niz samo da zadovoljimo TypeScript strukturu
        error: msg,
      };
    }
  }, [startDate, endDate, activeRates, capacity]);

  if (!priceCalculation || priceCalculation.totalNights <= 0) {
    return null;
  }

  // 🚨 VIZUELNI FAIL-FAST: Ako objekat sadrži grešku, ODMAH prekidamo standardni render
  // i ispisujemo uočljivi crveni blok. Nema šanse da se prikaže pogrešna ili nulta cena!
  if (priceCalculation.error) {
    return (
      <div
        className="price-preview-error"
        style={{
          padding: '12px',
          background: '#fef2f2',
          borderRadius: '6px',
          border: '1px solid #fca5a5',
          color: '#991b1b',
          fontSize: '13px',
        }}
      >
        <span style={{ fontWeight: 'bold' }}>⚠️ Nemoguće izračunati cenu:</span>
        <div style={{ marginTop: '4px', fontStyle: 'italic' }}>{priceCalculation.error}</div>
      </div>
    );
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
