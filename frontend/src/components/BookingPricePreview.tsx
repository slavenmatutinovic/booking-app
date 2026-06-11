import { useMemo } from 'react';
import { calculateStayPriceShared, CalculatePriceArgs } from '../../../shared/pricing';
import { format } from 'date-fns';

type BookingPricePreviewProps = Omit<CalculatePriceArgs, 'totalNights'> & {
  endDate: string; // Ekstra polje koje je neophodno klijentskom kalendaru za opseg
};

export const BookingPricePreview: React.FC<BookingPricePreviewProps> = ({
  rates, // Polje preuzeto direktno iz CalculatePriceArgs
  startDateInput, // Polje preuzeto direktno iz CalculatePriceArgs
  bookingCapacity, // Polje preuzeto direktno iz CalculatePriceArgs
  endDate, // Naše prošireno polje za kalendarski kraj opsega
  returnBreakdown = true,
}) => {
  // Memoize calculation loops to prevent unnecessary recalibration during re-renders
  // 🎯 JEDINSTVENI MEMO: Čist, bez redundantnih zavisnosti i bez skrivanja fatalnih grešaka
  const priceCalculation = useMemo(() => {
    if (!startDateInput || !endDate) return null;

    try {
      const d1 = new Date(startDateInput);
      const d2 = new Date(endDate);
      const computedNights = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));

      if (computedNights <= 0) {
        // Vraćamo čist objekat greške ako su datumi naopako okrenuti
        return { error: 'Datum odlaska mora biti nakon datuma dolaska.' };
      }
      // Pozivamo tvoj shared kod – ako fali cena, ovde momentalno puca izvršavanje!
      // 🔥 NEMA DUPLIRANJA LOGIKE: Prosleđujemo true i dobijamo kompletan breakdown iz shared-a
      const result = calculateStayPriceShared({
        rates,
        startDateInput,
        totalNights: computedNights,
        bookingCapacity,
        returnBreakdown,
      });

      return result;
    } catch (catchError: unknown) {
      // ✅  Hvata se stroga poruka i čuva se broj noćenja kako komponenta ne bi nestala
      // Presrećemo PRICING_FAILED grešku ako neka noć nema definisanu cenu u bazi podataka
      const errorMessage = catchError instanceof Error ? catchError.message : 'Nepoznata greška.';

      // Vraćamo objekat koji sadrži isključivo poruku o grešci
      return { error: errorMessage };
    }
  }, [startDateInput, endDate, rates, bookingCapacity, returnBreakdown]);

  // =============================================================================
  // 🎨 RENDERING BLOK (Odavde pa na dole se iscrtava korisnički interfejs)
  // =============================================================================

  // 1. Prvo proveravamo da li proračun uopšte postoji
  if (!priceCalculation) {
    return null;
  }

  // 2. 🚨 VIZUELNI FAIL-FAST: Ako objekat sadrži grešku, ODMAH prekidamo standardni render
  // Koristimo 'in' operator kao Type Guard da bezbedno pročitamo polje .error bez novih interfejsa
  if (
    typeof priceCalculation === 'object' &&
    'error' in priceCalculation &&
    priceCalculation.error
  ) {
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
          marginTop: '16px',
        }}
      >
        <span style={{ fontWeight: 'bold' }}>⚠️ Nemoguće izračunati cenu:</span>
        <div style={{ marginTop: '4px', fontStyle: 'italic' }}>
          {String((priceCalculation as Record<string, unknown>).error)}
        </div>
      </div>
    );
  }

  // 3. OKOLINA USPEŠNOG RENDERINGA:
  // Pošto smo gore eliminisali greške, ovde bezbedno kastujemo objekat u poznatu strukturu
  // kako bi TypeScript znao da polja breakdown, totalNights i totalPrice garantovano postoje!
  const successCalculation = priceCalculation as {
    totalNights: number;
    totalPrice: number;
    averagePricePerNight: number;
    breakdown: { dateStr: string; price: number }[];
  };

  return (
    <div
      style={{
        background: '#f8fafc',
        padding: '16px',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        marginTop: '16px',
        fontSize: '14px',
        width: '100%', // Osiguravamo stabilno širenje unutar kontejnera modala
      }}
    >
      <h3 style={{ fontWeight: 600, color: '#334155', marginBottom: '12px', fontSize: '15px' }}>
        🧮 Detaljan obračun cene boravka:
      </h3>

      {/* ── 1. Itemized Day-by-Day Dynamic Cost Matrix ────────────────── */}
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
        {/* Koristimo popravljenu i proverenu successCalculation promenljivu za .map() upit */}
        {successCalculation.breakdown.map((item, index) => (
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
              {/* Zadržavamo tvoju originalnu funkciju 'format' za ispis srpskog kalendarskog šablona */}
              Noćenje {index + 1}: ({format(new Date(item.dateStr), 'dd.MM.yyyy')})
            </span>

            <span style={{ fontWeight: 500, color: item.price === 0 ? '#ef4444' : '#475569' }}>
              {item.price === 0 ? 'Nema konfigurisanu cenu' : `${item.price.toFixed(2)} €`}
            </span>
          </div>
        ))}
      </div>

      {/* ── 2. Totalized Aggregate Summary Blocks ────────────────────── */}
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
          {/* Čitamo bezbedno mapiran broj noćenja sa servera / kalkulatora */}
          <span>{successCalculation.totalNights}</span>
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
          <span>{successCalculation.averagePricePerNight.toFixed(2)} €</span>
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
          <span>{successCalculation.totalPrice.toFixed(2)} €</span>
        </div>
      </div>
    </div>
  );
};
