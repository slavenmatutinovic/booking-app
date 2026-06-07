// =============================================================================
// 🧪 frontend/src/tests/dates-and-pricing.test.ts (Vitest Timezone Safe)
// =============================================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApartmentRateData } from '../../../shared';

// =============================================================================
// §1 — parseDateStr: timezone sigurnost
// =============================================================================

describe('parseDateStr — timezone sigurnost', () => {
  // 🛡️ BROWSER-SAFE ACCESSIBILITY: Read the environment property using a safe generic object contract
  const globalEnv = (globalThis as Record<string, unknown>).process as
    | Record<string, unknown>
    | undefined;
  const originalTZ =
    globalEnv?.env && typeof globalEnv.env === 'object'
      ? (globalEnv.env as Record<string, unknown>).TZ
      : undefined;

  beforeEach(() => {
    // Clear out module system cache boundaries cleanly before tests
    vi.resetModules();
  });

  afterEach(() => {
    // Restore the system ambient timezone tracking value safely using safe mappings
    if (globalEnv?.env && typeof globalEnv.env === 'object') {
      (globalEnv.env as Record<string, unknown>).TZ = originalTZ;
    }
  });

  it('ne pomera datum na mašinama u UTC-1 do UTC+14 zonama', async () => {
    const { parseDateStr } = await import('../utils/dates');

    // Matrix profiles testing structural timezone stability boundaries
    const simulatedZones = [
      'America/New_York',
      'UTC',
      'Europe/Belgrade',
      'Asia/Tokyo',
      'Pacific/Kiritimati',
    ];
    const cases = ['2026-01-01', '2026-06-15', '2026-12-31', '2027-02-28'];

    for (const zone of simulatedZones) {
      // ✅ FIXED: Safely assigning the simulated timezone property via runtime environment proxies
      if (globalEnv?.env && typeof globalEnv.env === 'object') {
        (globalEnv.env as Record<string, unknown>).TZ = zone;
      }

      for (const str of cases) {
        const parts = str.split('-');
        const y = parseInt(parts[0] ?? '0', 10);
        const m = parseInt(parts[1] ?? '0', 10);
        const d = parseInt(parts[2] ?? '0', 10);

        const date = parseDateStr(str);

        expect(date.getFullYear()).toBe(y);
        expect(date.getMonth()).toBe(m - 1);
        expect(date.getDate()).toBe(d);
      }
    }
  });

  it('naspram new Date(str) koji može pomeriti datum', async () => {
    const { parseDateStr } = await import('../utils/dates');
    const safe = parseDateStr('2026-01-01');

    expect(safe.getDate()).toBe(1);
    expect(safe.getMonth()).toBe(0);
    expect(safe.getFullYear()).toBe(2026);
  });
});

it('naspram new Date(str) koji može pomeriti datum', async () => {
  const { parseDateStr } = await import('../utils/dates');
  const safe = parseDateStr('2026-01-01');

  expect(safe.getDate()).toBe(1);
  expect(safe.getMonth()).toBe(0);
  expect(safe.getFullYear()).toBe(2026);
});

// =============================================================================
// §2 — calculateClientDynamicPrice
// =============================================================================

describe('calculateClientDynamicPrice', () => {
  // Striktno tipizirane lažne stope izvučene iz shared ugovora, bez 'any'
  const mockRates: ApartmentRateData[] = [
    {
      id: 'rate-summer-2',
      apartmentId: 'apt-1',
      startDate: '2027-07-01T00:00:00.000Z',
      endDate: '2027-08-31T23:59:59.999Z',
      price: 120,
      capacity: 2,
    },
    {
      id: 'rate-summer-3',
      apartmentId: 'apt-1',
      startDate: '2027-07-01T00:00:00.000Z',
      endDate: '2027-08-31T23:59:59.999Z',
      price: 150,
      capacity: 3,
    },
  ];

  it('T01 — Vraća tačnu cenu za 5 noći sa capacity=2', async () => {
    const { calculateClientDynamicPrice } = await import('../utils/pricingCalculator');
    const result = calculateClientDynamicPrice('2027-07-10', '2027-07-15', mockRates, 0, 2);

    expect(result.totalNights).toBe(5);
    expect(result.totalPrice).toBe(600); // 5 × 120
    expect(result.hasUnconfiguredDays).toBe(false);
  });

  it('T02 — Vraća tačnu cenu za capacity=3', async () => {
    const { calculateClientDynamicPrice } = await import('../utils/pricingCalculator');
    const result = calculateClientDynamicPrice('2027-07-10', '2027-07-15', mockRates, 0, 3);

    expect(result.totalNights).toBe(5);
    expect(result.totalPrice).toBe(750); // 5 × 150
  });

  it('T03 — hasUnconfiguredDays=true kada nema stope za datum', async () => {
    const { calculateClientDynamicPrice } = await import('../utils/pricingCalculator');
    const result = calculateClientDynamicPrice(
      '2027-06-28', // 3 dana van sezone (28, 29, 30. jun)
      '2027-07-03', // 3 dana u sezoni (1, 2, 3. jul)
      mockRates,
      0,
      2,
    );

    expect(result.totalNights).toBe(5);
    expect(result.hasUnconfiguredDays).toBe(true);
    expect(result.breakdown.length).toBe(5);
    expect(result.breakdown[0].price).toBe(0);
    expect(result.breakdown[3].price).toBe(120);
  });

  it('T04 — totalNights=0 za isti start i end', async () => {
    const { calculateClientDynamicPrice } = await import('../utils/pricingCalculator');
    const result = calculateClientDynamicPrice('2027-07-10', '2027-07-10', mockRates, 0, 2);

    expect(result.totalNights).toBe(0);
    expect(result.totalPrice).toBe(0);
  });

  it('T05 — fallbackPrice korišćen kada nema stope', async () => {
    const { calculateClientDynamicPrice } = await import('../utils/pricingCalculator');
    const result = calculateClientDynamicPrice(
      '2027-10-01',
      '2027-10-03',
      mockRates,
      50, // fallback = 50€
      2,
    );

    expect(result.totalPrice).toBe(100); // 2 noći × 50€
  });
});

// =============================================================================
// §3 — Konzistentnost između frontend i backend datuma
// =============================================================================

describe('Konzistentnost datuma frontend ↔ backend', () => {
  it('Datum selektovan u kalendaru je isti koji se šalje na server', async () => {
    const { parseDateStr, formatDate } = await import('../utils/dates');
    const selectedDate = parseDateStr('2027-07-15');

    expect(formatDate(selectedDate)).toBe('2027-07-15');
  });

  it('ISO string iz API-ja parsira u tačan lokalni datum', async () => {
    const { parseDateStr } = await import('../utils/dates');
    const apiResponse = '2027-07-15T00:00:00.000Z';
    const datePart = apiResponse.split('T')[0] ?? '';

    const localDate = parseDateStr(datePart);

    expect(localDate.getFullYear()).toBe(2027);
    expect(localDate.getMonth()).toBe(6); // Jul je indeks 6
    expect(localDate.getDate()).toBe(15);
  });
});
