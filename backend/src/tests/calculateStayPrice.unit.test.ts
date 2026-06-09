// =============================================================================
// 🧪 backend/src/tests/calculateStayPrice.unit.test.ts
// =============================================================================
//
// Unit testovi za calculateStayPrice() — čisti izolovan test bez baze.
//
// Kritični edge case koji fali u svim postojećim testovima:
//   • missing rate za jedan dan u SREDINI boravka (baca MISSING_RATE_FOR_DATE)
//   • crossing season boundary (različite cene za različite noći)
//   • capacity mismatch (ista sezona, pogrešan kapacitet)
//   • 0 noći, 1 noć, MAX_BOOKING_DAYS noći
//
// Pokretanje:
//   cd backend && npm test calculateStayPrice.unit
// =============================================================================

import { describe, it, expect } from '@jest/globals';
import { calculateStayPrice } from '../utils/bookingConflict';

// =============================================================================
// HELPER — Pravi mock ApartmentRate objekte sa ispravnim tipovima
// =============================================================================

function makeRate(
  startDate: string,
  endDate: string,
  price: number,
  capacity: number,
): Record<string, unknown> {
  return {
    id: `rate-${Math.random().toString(36).slice(2)}`,
    apartmentId: 'apt-test',
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    price,
    capacity,
  };
}

function utcDate(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 0, 0, 0, 0));
}

// =============================================================================
// §1 — Osnovna ispravnost
// =============================================================================

describe('calculateStayPrice — osnovna ispravnost', () => {
  const rates = [
    makeRate('2027-07-01', '2027-08-31', 100, 2),
    makeRate('2027-07-01', '2027-08-31', 130, 3),
  ];

  it('U01 — 5 noći × 100€ = 500€ za capacity 2', () => {
    const start = utcDate('2027-07-10');
    const result = calculateStayPrice(rates, start, 5, 2);
    expect(result).toBe(500);
  });

  it('U02 — 5 noći × 130€ = 650€ za capacity 3', () => {
    const start = utcDate('2027-07-10');
    const result = calculateStayPrice(rates, start, 5, 3);
    expect(result).toBe(650);
  });

  it('U03 — 1 noć vraća tačnu cenu', () => {
    const start = utcDate('2027-07-15');
    const result = calculateStayPrice(rates, start, 1, 2);
    expect(result).toBe(100);
  });

  it('U04 — 0 noći vraća 0 (nema iteracije)', () => {
    const start = utcDate('2027-07-10');
    const result = calculateStayPrice(rates, start, 0, 2);
    expect(result).toBe(0);
  });
});

// =============================================================================
// §2 — KRITIČNI edge case: missing rate za datum
// =============================================================================

describe('calculateStayPrice — missing rate baca MISSING_RATE_FOR_DATE', () => {
  it('U05 — Baca grešku ako nijedna stopa ne pokriva početni dan', () => {
    const rates = [
      makeRate('2027-08-01', '2027-08-31', 100, 2), // Sezone počinju u avgustu
    ];
    const start = utcDate('2027-07-28'); // 3 dana pre sezone
    expect(() => calculateStayPrice(rates, start, 5, 2)).toThrow('MISSING_RATE_FOR_DATE');
  });

  it('U06 — Baca grešku ako manjka rate za SREDNJI dan boravka', () => {
    // Sezone sa rupom: 1–10. jul i 12–31. jul (11. jul nije pokriven)
    const rates = [
      makeRate('2027-07-01', '2027-07-10', 100, 2),
      makeRate('2027-07-12', '2027-07-31', 120, 2),
    ];
    const start = utcDate('2027-07-09'); // Počinje u pokrivenoj sezoni
    // Dana 3 boravka je 2027-07-11 — rupa u sezoni
    expect(() => calculateStayPrice(rates, start, 5, 2)).toThrow('MISSING_RATE_FOR_DATE');
  });

  it('U07 — Poruka greške sadrži tačan datum koji nedostaje', () => {
    const rates = [
      makeRate('2027-07-01', '2027-07-10', 100, 2),
      makeRate('2027-07-12', '2027-07-31', 120, 2),
    ];
    const start = utcDate('2027-07-09');
    let errorMessage = '';
    try {
      calculateStayPrice(rates, start, 5, 2);
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : '';
    }
    expect(errorMessage).toContain('2027-07-11');
  });

  it('U08 — Baca grešku za pogrešan kapacitet (capacity mismatch)', () => {
    // Stopa postoji samo za capacity 2, ali rezervacija traži capacity 4
    const rates = [makeRate('2027-07-01', '2027-08-31', 100, 2)];
    const start = utcDate('2027-07-10');
    expect(() => calculateStayPrice(rates, start, 3, 4)).toThrow('MISSING_RATE_FOR_DATE');
  });
});

// =============================================================================
// §3 — Crossing season boundary (mešanje sezona)
// =============================================================================

describe('calculateStayPrice — crossing season boundary', () => {
  it('U09 — Boravak koji preseca granicu dve sezone koristi ispravnu cenu za svaki dan', () => {
    // Van sezone: 100€, Sezona: 200€
    const rates = [
      makeRate('2027-06-01', '2027-06-30', 100, 2), // Juni
      makeRate('2027-07-01', '2027-07-31', 200, 2), // Juli
    ];
    // Boravak: 29. jun — 3. jul = 4 noći
    // 29. jun = 100€, 30. jun = 100€, 1. jul = 200€, 2. jul = 200€
    const start = utcDate('2027-06-29');
    const result = calculateStayPrice(rates, start, 4, 2);
    expect(result).toBe(600); // 2×100 + 2×200
  });

  it('U10 — Tri sezone sa različitim cenama — tačan ukupni zbir', () => {
    const rates = [
      makeRate('2027-06-01', '2027-06-30', 80, 2),
      makeRate('2027-07-01', '2027-07-31', 160, 2),
      makeRate('2027-08-01', '2027-08-31', 200, 2),
    ];
    // 30. jun (1 noć × 80) + 1–5. jul (5 noći × 160) = 80 + 800 = 880
    const start = utcDate('2027-06-30');
    const result = calculateStayPrice(rates, start, 6, 2);
    expect(result).toBe(880);
  });
});

// =============================================================================
// §4 — DST sigurnost (datum se ne sme pomerati)
// =============================================================================

describe('calculateStayPrice — DST sigurnost', () => {
  it('U11 — Boravak koji prolazi kroz DST promenu (mart) vraća tačan broj noći', () => {
    // Evropska DST promena: poslednja nedelja marta
    const rates = [makeRate('2027-03-01', '2027-03-31', 90, 2)];
    // 26. mar → 31. mar = 5 noći (prelaz DST je između)
    const start = utcDate('2027-03-26');
    const result = calculateStayPrice(rates, start, 5, 2);
    expect(result).toBe(450); // 5 × 90
  });

  it('U12 — Boravak koji prolazi kroz DST promenu (oktobar) vraća tačan broj noći', () => {
    const rates = [makeRate('2027-10-01', '2027-10-31', 75, 2)];
    const start = utcDate('2027-10-29');
    const result = calculateStayPrice(rates, start, 3, 2);
    expect(result).toBe(225); // 3 × 75
  });
});

// =============================================================================
// §5 — Graničnih vrednosti
// =============================================================================

describe('calculateStayPrice — granične vrednosti', () => {
  it('U13 — 90 noći (MAX_BOOKING_DAYS) vraća tačan zbir', () => {
    const rates = [makeRate('2027-01-01', '2027-12-31', 50, 2)];
    const start = utcDate('2027-03-01');
    const result = calculateStayPrice(rates, start, 90, 2);
    expect(result).toBe(4500); // 90 × 50
  });

  it('U14 — Cena 0.01€ po noći — bez floating point greške na 30 noći', () => {
    const rates = [makeRate('2027-06-01', '2027-06-30', 0.01, 2)];
    const start = utcDate('2027-06-01');
    const result = calculateStayPrice(rates, start, 30, 2);
    // 30 × 0.01 = 0.3 — JavaScript float može dati 0.30000000000000004
    expect(result).toBeCloseTo(0.3, 10);
  });

  it('U15 — Sezonska stopa čija granica pada tačno na dan check-out — ne računa se', () => {
    // Check-in: 10. jul, Check-out: 15. jul → 5 noći (10, 11, 12, 13, 14. jul)
    // Stopa pokriva 1–15. jul — 15. jul (check-out) se NE broji kao noć
    const rates = [makeRate('2027-07-01', '2027-07-15', 100, 2)];
    const start = utcDate('2027-07-10');
    const result = calculateStayPrice(rates, start, 5, 2);
    expect(result).toBe(500); // 10, 11, 12, 13, 14 jul — sve pokriveno
  });

  it('U16 — basePricePerNight parametar se ignoriše kada postoji matchingRate', () => {
    const rates = [makeRate('2027-07-01', '2027-07-31', 100, 2)];
    const start = utcDate('2027-07-10');
    // Čak i ako prosleđujemo basePricePerNight=999, sezonska cena ima prioritet
    const result = calculateStayPrice(rates, start, 3, 2, 999);
    expect(result).toBe(300); // 3 × 100, ne 3 × 999
  });
});
