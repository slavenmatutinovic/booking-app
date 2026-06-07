// frontend/src/tests/stress-and-attack.test.ts
// =============================================================================
// 🔥 FRONTEND STRES I NAPADAČKI TESTOVI
//
// Pokreni: cd frontend && npx vitest run src/tests/stress-and-attack.test.ts
// =============================================================================

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { SelData, FrontendBooking } from '../types/ui';
import { ApiBooking } from '../../../shared';

// ── Mock: API ─────────────────────────────────────────────────────────────────
vi.mock('../api/bookings', () => ({
  createBooking: vi.fn(),
  createBookingRequest: vi.fn(),
  deleteBooking: vi.fn(),
  updateBooking: vi.fn(),
  getBookings: vi.fn(),
}));

vi.mock('../api/apartments', () => ({
  getApartments: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

// =============================================================================
// §1 PRICING CALCULATOR — edge case datumi
// =============================================================================

describe('STRES-FE-01: pricingCalculator — edge cases', () => {
  it('vraća 0 noći za iste datume', async () => {
    const { calculateClientDynamicPrice } = await import('../utils/pricingCalculator');
    const result = calculateClientDynamicPrice('2027-06-01', '2027-06-01', []);
    expect(result.totalNights).toBe(0);
    expect(result.totalPrice).toBe(0);
  });

  it('hasUnconfiguredDays je true kada nema cenovnika', async () => {
    const { calculateClientDynamicPrice } = await import('../utils/pricingCalculator');
    const result = calculateClientDynamicPrice('2027-06-01', '2027-06-05', []);
    expect(result.hasUnconfiguredDays).toBe(true);
    expect(result.totalPrice).toBe(0);
  });

  it('pravilno računa cenu za 5 noći', async () => {
    const { calculateClientDynamicPrice } = await import('../utils/pricingCalculator');
    const rates = [
      {
        id: 'rate-1',
        apartmentId: 'apt-1',
        startDate: '2027-01-01',
        endDate: '2027-12-31',
        price: 100,
        capacity: 2,
      },
    ];
    const result = calculateClientDynamicPrice('2027-06-01', '2027-06-06', rates, 0, 2);
    expect(result.totalNights).toBe(5);
    expect(result.totalPrice).toBe(500);
    expect(result.averagePricePerNight).toBe(100);
  });

  it('vraća fallback cenu kada kapacitet ne odgovara', async () => {
    const { calculateClientDynamicPrice } = await import('../utils/pricingCalculator');
    const rates = [
      {
        id: 'rate-1',
        apartmentId: 'apt-1',
        startDate: '2027-01-01',
        endDate: '2027-12-31',
        price: 100,
        capacity: 4, // ← Traži 2, ima 4
      },
    ];
    const result = calculateClientDynamicPrice('2027-06-01', '2027-06-04', rates, 50, 2);
    // fallbackPrice=50 se koristi jer kapacitet ne odgovara
    expect(result.hasUnconfiguredDays).toBe(true);
  });
});

// =============================================================================
// §2 DATE UTILS — granični slučajevi i timezone robustnost
// =============================================================================

describe('STRES-FE-02: parseDateStr — robustnost', () => {
  it('korektno parsira ISO datetime sa UTC zonom', async () => {
    const { parseDateStr } = await import('../utils/dates');
    const d = parseDateStr('2027-06-15T00:00:00.000Z');
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(15);
  });

  it('roundtrip za 1. januar (problematičan timezone datum)', async () => {
    const { parseDateStr, formatDate } = await import('../utils/dates');
    expect(formatDate(parseDateStr('2027-01-01'))).toBe('2027-01-01');
  });

  it('roundtrip za 31. decembar', async () => {
    const { parseDateStr, formatDate } = await import('../utils/dates');
    expect(formatDate(parseDateStr('2027-12-31'))).toBe('2027-12-31');
  });

  it('roundtrip za prestupnu godinu 29. februar', async () => {
    const { parseDateStr, formatDate } = await import('../utils/dates');
    expect(formatDate(parseDateStr('2028-02-29'))).toBe('2028-02-29');
  });
});

// =============================================================================
// §3 bookingsConflict — svi boundary slučajevi
// =============================================================================

describe('STRES-FE-03: bookingsConflict — kompletni boundary testovi', () => {
  let bookingsConflict: typeof import('../hooks/calendarActions').bookingsConflict;

  beforeEach(async () => {
    const m = await import('../hooks/calendarActions');
    bookingsConflict = m.bookingsConflict;
  });

  const makeBooking = (start: string, end: string) => ({
    id: 'b1',
    apartmentId: 'apt-1',
    start,
    end,
    guest: 'Test',
    email: 't@t.com',
    color: '#000',
    totalPrice: 0,
    capacity: 2,
  });

  it('otkriva direktno preklapanje', () => {
    expect(
      bookingsConflict(
        { start: '2027-06-01', end: '2027-06-10' },
        makeBooking('2027-06-05', '2027-06-15'),
      ),
    ).toBe(true);
  });

  it('nema konflikta kad se rezervacije nadovezuju (checkout = checkin)', () => {
    // Hotel logika: Jun 1-5 i Jun 5-10 su isti dan (checkout = checkin)
    expect(
      bookingsConflict(
        { start: '2027-06-01', end: '2027-06-05' },
        makeBooking('2027-06-05', '2027-06-10'),
      ),
    ).toBe(false);
  });

  it('nema konflikta za potpuno odvojene periode', () => {
    expect(
      bookingsConflict(
        { start: '2027-06-01', end: '2027-06-05' },
        makeBooking('2027-07-01', '2027-07-10'),
      ),
    ).toBe(false);
  });

  it('otkriva potpuno sadržanu rezervaciju', () => {
    expect(
      bookingsConflict(
        { start: '2027-06-01', end: '2027-06-30' },
        makeBooking('2027-06-05', '2027-06-10'),
      ),
    ).toBe(true);
  });

  it('otkriva obrnuto sadržanu rezervaciju', () => {
    expect(
      bookingsConflict(
        { start: '2027-06-05', end: '2027-06-07' },
        makeBooking('2027-06-01', '2027-06-30'),
      ),
    ).toBe(true);
  });

  it('nema konflikta za jednonoćno boravak odmah posle drugog', () => {
    expect(
      bookingsConflict(
        { start: '2027-06-10', end: '2027-06-11' },
        makeBooking('2027-06-09', '2027-06-10'),
      ),
    ).toBe(false);
  });
});

// =============================================================================
// §4 executeCreateBooking — frontend lokalna provjera konflikta
// =============================================================================

describe('STRES-FE-04: executeCreateBooking — lokalna konflikt provjera', () => {
  it('prikazuje toast error umesto API poziva pri lokalnom konfliktu', async () => {
    const toast = await import('react-hot-toast');
    const { createBooking } = await import('../api/bookings');

    const { executeCreateBooking } = await import('../hooks/calendarActions');

    const existingBookings = [
      {
        id: 'b1',
        apartmentId: 'apt-1',
        start: '2027-06-01',
        end: '2027-06-10',
        guest: 'Postojeći',
        email: 'p@p.com',
        color: '#000',
        totalPrice: 0,
        capacity: 2,
      },
    ];

    await executeCreateBooking({
      aptId: 'apt-1',
      guestName: 'Novi Gost',
      email: 'novi@test.com',
      phone: '',
      selData: {
        startDate: new Date('2027-06-05'),
        endDate: new Date('2027-06-08'),
        aptId: 'apt-1',
      } as SelData,
      bookings: existingBookings,
      setBookings: vi.fn(),
      setSelection: vi.fn(),
      isAdmin: true,
    });

    // API se ne smije pozvati
    expect(createBooking).not.toHaveBeenCalled();
    // Toast error mora biti prikazan
    expect(toast.default.error).toHaveBeenCalledWith('Izabrani termin je zauzet!');
  });
});

// =============================================================================
// §5 XSS SANITIZACIJA — opasan input u guest polju
// =============================================================================

describe('STRES-FE-05: XSS i opasni input u guest/email polju', () => {
  it('pricingCalculator ne crashi na xss u startDate stringu', async () => {
    const { calculateClientDynamicPrice } = await import('../utils/pricingCalculator');
    expect(() =>
      calculateClientDynamicPrice('<script>alert(1)</script>', '2027-06-05', []),
    ).not.toThrow();
  });

  it('parseDateStr ne crashi na prazan string', async () => {
    const { parseDateStr } = await import('../utils/dates');
    // NaN datum — ne sme crash, ali nije validan
    const result = parseDateStr('');
    expect(result).toBeInstanceOf(Date);
  });
});

// =============================================================================
// §6 RAPID STATE UPDATES — optimistic UI bez memorijskog curenja
// =============================================================================

describe('STRES-FE-06: Brzo kreiranje i brisanje (optimistic update stabilnost)', () => {
  it('setBookings se poziva sa ispravnim niz transformacijama', async () => {
    const bookingsApiModule = (await import('../api/bookings')) as unknown as {
      createBooking: Mock & { mockResolvedValue: (value: ApiBooking) => void };
    };

    bookingsApiModule.createBooking.mockResolvedValue({
      id: 'created-1',
      apartmentId: 'apt-1',
      startDate: '2027-07-01T00:00:00.000Z',
      endDate: '2027-07-05T00:00:00.000Z',
      guest: 'Test',
      email: 't@t.com',
      totalPrice: 400,
      status: 'CONFIRMED',
    });

    type SetBookingsUpdater = (prev: FrontendBooking[]) => FrontendBooking[];

    const bookingsRef: FrontendBooking[] = [];
    const setBookings = vi.fn((updater: SetBookingsUpdater | FrontendBooking[]) => {
      const next = typeof updater === 'function' ? updater(bookingsRef) : updater;
      bookingsRef.splice(0, bookingsRef.length, ...next);
    });

    const { executeCreateBooking } = await import('../hooks/calendarActions');

    await executeCreateBooking({
      aptId: 'apt-1',
      guestName: 'Brzi Gost',
      email: 'brzi@test.com',
      phone: '',
      selData: {
        startDate: new Date('2027-07-01'),
        endDate: new Date('2027-07-05'),
        aptId: 'apt-1',
      } as SelData,
      bookings: [],
      setBookings,
      setSelection: vi.fn(),
      isAdmin: true,
    });

    // setBookings je pozvan bar jednom
    expect(setBookings).toHaveBeenCalled();
    // Nema temp booking-a u finalnom stanju
    const tempBookings = bookingsRef.filter((b) => b.id?.startsWith('temp-'));
    expect(tempBookings.length).toBe(0);
  });
});
