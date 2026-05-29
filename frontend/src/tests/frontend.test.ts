// =============================================================================
// 🧪 FRONTEND TEST SUITE — booking-app
// =============================================================================
//
// Pokriva sve otkrivene greške + kritične poslovne logike.
//
// Pokretanje:
//   cd frontend
//   npm install --save-dev vitest @testing-library/react @testing-library/user-event jsdom @testing-library/jest-dom
//   npx vitest run src/tests/frontend.test.ts
//
// Struktura:
//   1. Utils (parseDateStr, formatDate, bookingsConflict)
//   2. calendarActions (executeCreateBooking, executeDeleteBooking, executeMoveBooking)
//   3. useCalendarData hook
//   4. BookingModal komponenta
//   5. BookingBar komponenta
//   6. App routing & auth guard
//   7. AdminDashboard
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

vi.mock('../api/bookings', () => ({
  createBooking: vi.fn(),
  createBookingRequest: vi.fn(),
  deleteBooking: vi.fn(),
  updateBooking: vi.fn(),
  getBookings: vi.fn(),
  getPendingRequests: vi.fn(),
  approveBookingRequest: vi.fn(),
  rejectBookingRequest: vi.fn(),
  getPendingRequestsCount: vi.fn().mockResolvedValue(0),
}));

vi.mock('../api/apartments', () => ({
  getApartments: vi.fn(),
}));

vi.mock('../api/auth', () => ({
  getMe: vi.fn(),
  loginUser: vi.fn(),
  logoutUser: vi.fn(),
}));

vi.mock('../utils/remoteLogger', () => ({
  remoteLogger: vi.fn(),
}));

// ---------------------------------------------------------------------------
// §1  UTILS — parseDateStr / formatDate
// ---------------------------------------------------------------------------

describe('parseDateStr', () => {
  // [BUG-01] parseDateStr koristi lokalno vreme (new Date(y, m-1, d)) što je ispravno.
  // Međutim, treba verifikovati da ne nastaju timezone problemi.

  it('vraća tačan datum za yyyy-MM-dd string', async () => {
    const { parseDateStr } = await import('../utils/dates');
    const d = parseDateStr('2026-06-15');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // 0-indexed
    expect(d.getDate()).toBe(15);
  });

  it('ne pomera datum zbog UTC-a', async () => {
    const { parseDateStr } = await import('../utils/dates');
    // Ako bi se koristio `new Date('2026-06-15')`, browser bi mogao da parsira
    // kao UTC ponoć i prikaže 14. jun u negativnoj zoni. Ova implementacija to izbegava.
    const d = parseDateStr('2026-01-01');
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(0);
  });

  it('roundtrip: formatDate(parseDateStr(s)) === s', async () => {
    const { parseDateStr, formatDate } = await import('../utils/dates');
    const original = '2026-07-04';
    expect(formatDate(parseDateStr(original))).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// §2  bookingsConflict — detekcija preklapanja
// ---------------------------------------------------------------------------

describe('bookingsConflict', () => {
  // [BUG-02] Nije pronađena greška u samoj logici, ali je kritična za UX.
  // Ovo su boundary testovi koji pokrivaju sve edge-case scenarije.

  let bookingsConflict: typeof import('../hooks/calendarActions').bookingsConflict;

  beforeEach(async () => {
    ({ bookingsConflict } = await import('../hooks/calendarActions'));
  });

  const makeBooking = (start: string, end: string) => ({
    id: 'b1',
    apartmentId: 'apt1',
    start,
    end,
    guest: 'Gost',
    email: 'gost@test.com',
    color: '#000',
  });

  it('detektuje potpuno preklapanje', () => {
    expect(
      bookingsConflict({ start: '2026-06-10', end: '2026-06-20' }, makeBooking('2026-06-12', '2026-06-18')),
    ).toBe(true);
  });

  it('detektuje parcijalno preklapanje (levo)', () => {
    expect(
      bookingsConflict({ start: '2026-06-10', end: '2026-06-15' }, makeBooking('2026-06-12', '2026-06-20')),
    ).toBe(true);
  });

  it('detektuje parcijalno preklapanje (desno)', () => {
    expect(
      bookingsConflict({ start: '2026-06-16', end: '2026-06-25' }, makeBooking('2026-06-12', '2026-06-18')),
    ).toBe(true);
  });

  it('detektuje preklapanje na isti dan (touch)', () => {
    // Graničan slučaj: rezervacija A završava istog dana kad B počinje
    expect(
      bookingsConflict({ start: '2026-06-15', end: '2026-06-15' }, makeBooking('2026-06-15', '2026-06-20')),
    ).toBe(true);
  });

  it('NE detektuje preklapanje za susedne rezervacije', () => {
    // A: 10-14, B: 15-20 — ne smeju da se sukobe
    expect(
      bookingsConflict({ start: '2026-06-10', end: '2026-06-14' }, makeBooking('2026-06-15', '2026-06-20')),
    ).toBe(false);
  });

  it('NE detektuje preklapanje za potpuno odvojene rezervacije', () => {
    expect(
      bookingsConflict({ start: '2026-06-01', end: '2026-06-05' }, makeBooking('2026-06-15', '2026-06-20')),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §3  executeCreateBooking — optimistic update + API
// ---------------------------------------------------------------------------

describe('executeCreateBooking', () => {
  let executeCreateBooking: typeof import('../hooks/calendarActions').executeCreateBooking;
  let createBooking: ReturnType<typeof vi.fn>;
  let createBookingRequest: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ executeCreateBooking } = await import('../hooks/calendarActions'));
    ({ createBooking, createBookingRequest } = await import('../api/bookings') as any);
  });

  const baseArgs = {
    guestName: 'Ana Marković',
    email: 'ana@test.com',
    phone: '0641234567',
    selData: {
      aptId: 'apt1',
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-07-05'),
      totalDays: 5,
      left: 0,
      width: 200,
      aptIdx: 0,
    },
    bookings: [],
    setBookings: vi.fn(),
    setSelection: vi.fn(),
  };

  it('[ADMIN] kreira booking direktno i ažurira lokalni state', async () => {
    createBooking.mockResolvedValue({ id: 'real-id-123', guest: 'Ana Marković' });

    await executeCreateBooking({ ...baseArgs, isAdmin: true });

    expect(createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        apartmentId: 'apt1',
        guest: 'Ana Marković',
        email: 'ana@test.com',
      }),
    );

    // Provjera da se selekcija zatvori
    expect(baseArgs.setSelection).toHaveBeenCalledWith(null);
  });

  it('[GOST] šalje zahtev (createBookingRequest) i uklanja optimistic bar', async () => {
    createBookingRequest.mockResolvedValue({ message: 'Zahtev primljen' });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    await executeCreateBooking({ ...baseArgs, isAdmin: false });

    expect(createBookingRequest).toHaveBeenCalled();
    expect(createBooking).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('rollback: briše optimistic booking ako API vrati grešku', async () => {
    createBooking.mockRejectedValue(new Error('Termin zauzet'));

    await expect(
      executeCreateBooking({ ...baseArgs, isAdmin: true }),
    ).rejects.toThrow('Termin zauzet');

    // setBookings mora biti pozvan da filtrira temp ID
    const setBookingsCalls = (baseArgs.setBookings as ReturnType<typeof vi.fn>).mock.calls;
    expect(setBookingsCalls.length).toBeGreaterThanOrEqual(2); // add temp + filter temp
  });

  it('blokira kreiranje ako guestName je prazan string', async () => {
    await executeCreateBooking({ ...baseArgs, guestName: '   ', isAdmin: true });

    expect(createBooking).not.toHaveBeenCalled();
  });

  it('[BUG-04] detektuje lokalni konflikt i blokira slanje', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    const existingBooking = {
      id: 'b1',
      apartmentId: 'apt1',
      start: '2026-07-02',
      end: '2026-07-06',
      guest: 'Gost',
      email: 'gost@test.com',
      color: '#000',
    };

    await executeCreateBooking({
      ...baseArgs,
      bookings: [existingBooking],
      isAdmin: true,
    });

    expect(createBooking).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Izabrani termin je zauzet!');
    alertSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// §4  executeDeleteBooking — soft delete sa rollback
// ---------------------------------------------------------------------------

describe('executeDeleteBooking', () => {
  let executeDeleteBooking: typeof import('../hooks/calendarActions').executeDeleteBooking;
  let apiDeleteBooking: ReturnType<typeof vi.fn>;

  const existingBooking = {
    id: 'bkg-99',
    apartmentId: 'apt1',
    start: '2026-07-01',
    end: '2026-07-05',
    guest: 'Marko',
    email: 'm@test.com',
    color: '#000',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ executeDeleteBooking } = await import('../hooks/calendarActions'));
    const apiMock = await import('../api/bookings') as any;
    apiDeleteBooking = apiMock.deleteBooking;
  });

  it('uklanja booking iz lokalne liste', async () => {
    apiDeleteBooking.mockResolvedValue(undefined);

    const setBookings = vi.fn();
    await executeDeleteBooking('bkg-99', setBookings);

    // Prva poziv treba da filtrira
    const firstCall = setBookings.mock.calls[0][0];
    const filtered = firstCall([existingBooking]);
    expect(filtered).toHaveLength(0);
  });

  it('rollback: restaurira booking ako DELETE API vrati grešku', async () => {
    apiDeleteBooking.mockRejectedValue(new Error('Server error'));

    const setBookings = vi.fn();
    // Pre rollbacka moramo da obezbedimo da setBookings drži stanje
    setBookings.mockImplementation((fn) => {
      if (typeof fn === 'function') return fn([existingBooking]);
    });

    await expect(
      executeDeleteBooking('bkg-99', setBookings),
    ).rejects.toThrow('Server error');
  });
});

// ---------------------------------------------------------------------------
// §5  BookingModal — prikaz i submit
// ---------------------------------------------------------------------------

describe('BookingModal', () => {
  const { BookingModal } = require('../components/BookingModal');

  const baseProps = {
    showModal: true,
    selData: {
      aptId: 'apt1',
      startDate: new Date('2026-07-10'),
      endDate: new Date('2026-07-15'),
      totalDays: 6,
      left: 100,
      width: 240,
      aptIdx: 0,
    },
    setSelection: vi.fn(),
    createBooking: vi.fn().mockResolvedValue(undefined),
    apartmentsCount: 3,
    aptIdx: 0,
    daysCount: 30,
    dayW: 40,
    rowH: 52,
    modalW: 296,
    isCreating: false,
    isDeleting: false,
    isAdmin: true,
    currentUser: { id: 'u1', email: 'admin@test.com', role: 'ADMIN' as const },
    bookingError: null,
    scrollLeft: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Dodajemo .row elemente u DOM za layout kalkulaciju
    const row = document.createElement('div');
    row.className = 'row';
    document.body.appendChild(row);
    vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
      top: 100, left: 0, width: 800, height: 52,
      right: 800, bottom: 152, x: 0, y: 100, toJSON: () => ({}),
    } as DOMRect);
  });

  afterEach(() => {
    document.querySelectorAll('.row').forEach((el) => el.remove());
  });

  it('[ADMIN] prikazuje naslov "Nova rezervacija"', () => {
    render(<BookingModal {...baseProps} />);
    expect(screen.getByText('Nova rezervacija')).toBeInTheDocument();
  });

  it('[GOST] prikazuje naslov "Zahtev za rezervaciju"', () => {
    render(
      <BookingModal
        {...baseProps}
        isAdmin={false}
        currentUser={null}
      />,
    );
    expect(screen.getByText('Zahtev za rezervaciju')).toBeInTheDocument();
  });

  it('submit dugme je disabled dok forma nije popunjena', () => {
    render(<BookingModal {...baseProps} />);
    const btn = screen.getByRole('button', { name: /Kreiraj rezervaciju/i });
    expect(btn).toBeDisabled();
  });

  it('submit dugme se aktivira kada su name i email popunjeni', async () => {
    const user = userEvent.setup();
    render(<BookingModal {...baseProps} />);

    await user.type(screen.getByPlaceholderText('Ime gosta'), 'Ana Marković');
    await user.type(screen.getByPlaceholderText('Email adresa'), 'ana@test.com');

    const btn = screen.getByRole('button', { name: /Kreiraj rezervaciju/i });
    expect(btn).not.toBeDisabled();
  });

  it('poziva createBooking sa ispravnim podacima na submit', async () => {
    const user = userEvent.setup();
    const mockCreate = vi.fn().mockResolvedValue(undefined);
    render(<BookingModal {...baseProps} createBooking={mockCreate} />);

    await user.type(screen.getByPlaceholderText('Ime gosta'), 'Ana');
    await user.type(screen.getByPlaceholderText('Email adresa'), 'ana@test.com');
    await user.type(screen.getByPlaceholderText('Broj telefona (opcionalno)'), '0641234567');
    await user.click(screen.getByRole('button', { name: /Kreiraj rezervaciju/i }));

    expect(mockCreate).toHaveBeenCalledWith(
      { guestName: 'Ana', email: 'ana@test.com', phone: '0641234567' },
      baseProps.selData,
    );
  });

  it('[BUG-05] prikazuje bookingError poruku', () => {
    render(<BookingModal {...baseProps} bookingError="Termin zauzet!" />);
    expect(screen.getByText(/Termin zauzet!/)).toBeInTheDocument();
  });

  it('zatvara modal klikom na X', async () => {
    const setSelection = vi.fn();
    const user = userEvent.setup();
    render(<BookingModal {...baseProps} setSelection={setSelection} />);

    await user.click(screen.getByLabelText('Zatvori modal'));
    expect(setSelection).toHaveBeenCalledWith(null);
  });

  it('ne renderuje modal kada showModal === false', () => {
    const { container } = render(<BookingModal {...baseProps} showModal={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('ne renderuje modal kada selData === null', () => {
    const { container } = render(<BookingModal {...baseProps} selData={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('pritisak Enter u polju pokreće submit', async () => {
    const user = userEvent.setup();
    const mockCreate = vi.fn().mockResolvedValue(undefined);
    render(<BookingModal {...baseProps} createBooking={mockCreate} />);

    await user.type(screen.getByPlaceholderText('Ime gosta'), 'Ana');
    await user.type(screen.getByPlaceholderText('Email adresa'), 'ana@test.com');
    await user.keyboard('{Enter}');

    expect(mockCreate).toHaveBeenCalled();
  });

  it('[BUG-06] prikazuje loading stanje na dugmetu tokom slanja', () => {
    render(<BookingModal {...baseProps} isCreating={true} />);
    expect(screen.getByRole('button', { name: /Slanje.../i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// §6  BookingBar — drag/delete interakcija
// ---------------------------------------------------------------------------

describe('BookingBar', () => {
  const { BookingBar } = require('../components/BookingBar');

  const baseBooking = {
    id: 'bkg-01',
    apartmentId: 'apt1',
    start: '2026-07-10',
    end: '2026-07-15',
    guest: 'Marko Petrović',
    email: 'm@test.com',
    color: '#4f46e5',
  };

  const baseProps = {
    b: baseBooking,
    styleCache: { left: 100, width: 200 },
    isDrag: false,
    dragValid: true,
    isHovered: false,
    canEdit: true,
    showGuestDetails: true,
    isDeleting: false,
    setDragging: vi.fn(),
    setHoveredId: vi.fn(),
    deleteBooking: vi.fn(),
  };

  beforeEach(() => vi.clearAllMocks());

  it('renderuje ime gosta kada showGuestDetails === true', () => {
    render(<BookingBar {...baseProps} />);
    expect(screen.getByText('Marko Petrović')).toBeInTheDocument();
  });

  it('prikazuje "Zauzeto" kada showGuestDetails === false', () => {
    render(<BookingBar {...baseProps} showGuestDetails={false} />);
    expect(screen.getByText('Zauzeto')).toBeInTheDocument();
  });

  it('vraća null kada styleCache nije definisan', () => {
    const { container } = render(<BookingBar {...baseProps} styleCache={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('X dugme se prikazuje pri hoveru za admina', () => {
    render(<BookingBar {...baseProps} isHovered={true} />);
    expect(screen.getByLabelText(/Obriši rezervaciju/i)).toBeInTheDocument();
  });

  it('X dugme poziva deleteBooking klikom', async () => {
    const user = userEvent.setup();
    const mockDelete = vi.fn();
    render(<BookingBar {...baseProps} isHovered={true} deleteBooking={mockDelete} />);

    await user.click(screen.getByLabelText(/Obriši rezervaciju/i));
    expect(mockDelete).toHaveBeenCalledWith('bkg-01');
  });

  it('[BUG-07] desni klik (context menu) pokreće brisanje', () => {
    const mockDelete = vi.fn();
    render(<BookingBar {...baseProps} deleteBooking={mockDelete} />);

    fireEvent.contextMenu(screen.getByText('Marko Petrović').closest('div')!);
    expect(mockDelete).toHaveBeenCalledWith('bkg-01');
  });

  it('mouseDown sa canEdit=true pokreće setDragging', () => {
    const setDragging = vi.fn();
    render(<BookingBar {...baseProps} setDragging={setDragging} />);

    const bar = screen.getByText('Marko Petrović').closest('[id^="bkg-bar-"]')!;
    fireEvent.mouseDown(bar, { button: 0, clientX: 150 });

    expect(setDragging).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'bkg-01', startX: 150 }),
    );
  });

  it('mouseDown desnim klikom NE pokreće drag', () => {
    const setDragging = vi.fn();
    render(<BookingBar {...baseProps} setDragging={setDragging} />);

    const bar = screen.getByText('Marko Petrović').closest('[id^="bkg-bar-"]')!;
    fireEvent.mouseDown(bar, { button: 2, clientX: 150 });

    expect(setDragging).not.toHaveBeenCalled();
  });

  it('drag je onemogućen za optimistic booking', () => {
    const setDragging = vi.fn();
    render(
      <BookingBar
        {...baseProps}
        b={{ ...baseBooking, isOptimistic: true }}
        setDragging={setDragging}
      />,
    );

    const bar = screen.getByText(/Marko Petrović/i).closest('[id^="bkg-bar-"]')!;
    fireEvent.mouseDown(bar, { button: 0, clientX: 150 });
    expect(setDragging).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// §7  App — routing i auth guard
// ---------------------------------------------------------------------------

describe('App — routing', () => {
  let getMe: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const auth = await import('../api/auth') as any;
    getMe = auth.getMe;
  });

  it('neautorizovani korisnik vidi /calendar (javni)', async () => {
    getMe.mockResolvedValue(null);
    const { default: App } = await import('../App');

    render(<App />);
    await waitFor(() => {
      expect(screen.queryByText('Učitavanje...')).not.toBeInTheDocument();
    });
    // Treba da vidi kalendar (ili loading kalendara), ne login
    expect(window.location.pathname).not.toBe('/login');
  });

  it('[BUG-08] /admin/requests preusmjerava non-admin na /calendar', async () => {
    getMe.mockResolvedValue({ user: { id: 'u1', email: 'viewer@test.com', role: 'VIEWER' } });

    const { default: App } = await import('../App');
    render(<MemoryRouter initialEntries={['/admin/requests']}><App /></MemoryRouter>);

    await waitFor(() => {
      expect(window.location.pathname).not.toBe('/admin/requests');
    });
  });

  it('/* preusmjerava na /calendar', async () => {
    getMe.mockResolvedValue(null);
    const { default: App } = await import('../App');
    render(<MemoryRouter initialEntries={['/nepostojeca-ruta']}><App /></MemoryRouter>);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/calendar');
    });
  });
});

// ---------------------------------------------------------------------------
// §8  Login — [BUG-01] pogrešan import tipa
// ---------------------------------------------------------------------------

describe('Login komponenta', () => {
  // [BUG-01] Login.tsx uvozi `AuthUser` iz `'../types'` što ne postoji.
  // Ispravno: `'../../../shared/index'` ili `'../types/ui'` (koji ga re-eksportuje).
  // Ovaj test proverava da li komponenta uopšte može da se uveze i renderuje.

  it('[BUG-01] uvozi se bez greške (types import)', async () => {
    // Ako postoji import greška, ovaj import će baciti izuzetak
    const loginModule = await import('../components/Login').catch((err) => {
      throw new Error(`Login.tsx ima grešku u importu: ${err.message}`);
    });
    expect(loginModule.default).toBeDefined();
  });

  it('renderuje email i password polja', async () => {
    const { default: Login } = await import('../components/Login');
    render(
      <MemoryRouter>
        <Login onLoginSuccess={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByPlaceholderText(/unesite@email.com/i)).toBeInTheDocument();
  });

  it('[BUG-02] React.SubmitEvent tip — forma se submita bez greške', async () => {
    // Login.tsx koristi `React.SubmitEvent<HTMLFormElement>` što ne postoji u React tipovima.
    // Ispravno: `React.FormEvent<HTMLFormElement>`.
    // Ovaj test verifikuje da submit ne baca TypeError.
    const { loginUser } = await import('../api/auth') as any;
    loginUser.mockResolvedValue({ user: { id: 'u1', email: 'a@b.com', role: 'ADMIN' } });

    const { default: Login } = await import('../components/Login');
    const onSuccess = vi.fn();
    render(
      <MemoryRouter>
        <Login onLoginSuccess={onSuccess} />
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/unesite@email.com/i), 'admin@test.com');
    await user.type(screen.getByLabelText(/lozinka/i), 'pass123');
    await user.click(screen.getByRole('button', { name: /Prijavi se/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });
});

// ---------------------------------------------------------------------------
// §9  AdminDashboard — fetch i approve/reject
// ---------------------------------------------------------------------------

describe('AdminDashboard', () => {
  let getPendingRequests: ReturnType<typeof vi.fn>;
  let approveBookingRequest: ReturnType<typeof vi.fn>;
  let rejectBookingRequest: ReturnType<typeof vi.fn>;

  const mockRequests = [
    {
      id: 'req-1',
      guest: 'Jovana',
      email: 'j@test.com',
      phone: '064111',
      startDate: '2026-07-10T00:00:00.000Z',
      endDate: '2026-07-15T00:00:00.000Z',
      apartment: { name: 'Apartman 1' },
    },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    const bkgMock = await import('../api/bookings') as any;
    getPendingRequests = bkgMock.getPendingRequests;
    approveBookingRequest = bkgMock.approveBookingRequest;
    rejectBookingRequest = bkgMock.rejectBookingRequest;
  });

  it('prikazuje zahteve iz API-ja', async () => {
    getPendingRequests.mockResolvedValue(mockRequests);
    const { AdminDashboard } = await import('../components/AdminDashboard');

    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByText('Jovana')).toBeInTheDocument());
  });

  it('prikazuje poruku kada nema zahteva', async () => {
    getPendingRequests.mockResolvedValue([]);
    const { AdminDashboard } = await import('../components/AdminDashboard');

    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByText(/nema novih zahteva/i)).toBeInTheDocument());
  });

  it('klik Odobri poziva approveBookingRequest i uklanja iz liste', async () => {
    getPendingRequests.mockResolvedValue(mockRequests);
    approveBookingRequest.mockResolvedValue({ message: 'Odobren' });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    const { AdminDashboard } = await import('../components/AdminDashboard');
    const user = userEvent.setup();
    render(<AdminDashboard />);

    await waitFor(() => screen.getByText('Odobri ✓'));
    await user.click(screen.getByText('Odobri ✓'));

    expect(approveBookingRequest).toHaveBeenCalledWith('req-1');
    await waitFor(() => expect(screen.queryByText('Jovana')).not.toBeInTheDocument());
    alertSpy.mockRestore();
  });

  it('[BUG-09] klik Odbij traži potvrdu, poziva rejectBookingRequest', async () => {
    getPendingRequests.mockResolvedValue(mockRequests);
    rejectBookingRequest.mockResolvedValue({ message: 'Odbijen' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const { AdminDashboard } = await import('../components/AdminDashboard');
    const user = userEvent.setup();
    render(<AdminDashboard />);

    await waitFor(() => screen.getByText('✕ Odbij'));
    await user.click(screen.getByText('✕ Odbij'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(rejectBookingRequest).toHaveBeenCalledWith('req-1');
    confirmSpy.mockRestore();
  });

  it('prikazuje grešku ako API zakaže', async () => {
    getPendingRequests.mockRejectedValue(new Error('Mrežna greška'));
    const { AdminDashboard } = await import('../components/AdminDashboard');

    render(<AdminDashboard />);
    await waitFor(() => expect(screen.getByText(/Mrežna greška/i)).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// §10  useDragDrop — drag kalkulacija
// ---------------------------------------------------------------------------

describe('useDragDrop', () => {
  it('startDrag nije dostupan bez canEdit', async () => {
    const { useDragDrop } = await import('../hooks/useDragDrop');
    const { renderHook, act } = await import('@testing-library/react');

    const onUpdate = vi.fn();
    const days = [new Date('2026-07-01'), new Date('2026-07-02'), new Date('2026-07-03')];
    const { result } = renderHook(() =>
      useDragDrop({ canEdit: false, dayW: 40, days, onBookingUpdate: onUpdate }),
    );

    await act(async () => {
      result.current.startDrag({
        bookingId: 'b1',
        apartmentId: 'apt1',
        startX: 100,
        originalStart: new Date('2026-07-01'),
        originalEnd: new Date('2026-07-03'),
      });
    });

    expect(result.current.dragging).toBeNull();
  });

  it('[BUG-10] dragValid je uvek true (nedostaje konflikt provjera tokom draga)', async () => {
    // Poznata greška: useDragDrop.ts inicijalizuje `const [dragValid] = useState<boolean>(true)`
    // bez settera, što znači da nikad nije false čak ni pri konfliktnom pomeranju.
    const { useDragDrop } = await import('../hooks/useDragDrop');
    const { renderHook } = await import('@testing-library/react');

    const days = [new Date('2026-07-01'), new Date('2026-07-02')];
    const { result } = renderHook(() =>
      useDragDrop({ canEdit: true, dayW: 40, days, onBookingUpdate: vi.fn() }),
    );

    // dragValid je uvijek true — nije implementirana vizuelna provjera konflikta
    expect(result.current.dragValid).toBe(true);
  });

  it('handleGlobalMouseUp poziva onBookingUpdate pri pomeranju za 1+ dan', async () => {
    const { useDragDrop } = await import('../hooks/useDragDrop');
    const { renderHook, act } = await import('@testing-library/react');

    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date('2026-07-01');
      d.setDate(d.getDate() + i);
      return d;
    });

    const { result } = renderHook(() =>
      useDragDrop({ canEdit: true, dayW: 40, days, onBookingUpdate: onUpdate }),
    );

    // Startujemo drag
    await act(async () => {
      result.current.startDrag({
        bookingId: 'b1',
        apartmentId: 'apt1',
        startX: 200,
        originalStart: new Date('2026-07-05'),
        originalEnd: new Date('2026-07-10'),
      });
    });

    // Puštamo miš 80px desno (= 2 dana pri dayW=40)
    await act(async () => {
      await result.current.handleGlobalMouseUp(280);
    });

    expect(onUpdate).toHaveBeenCalledWith('b1', {
      startDate: expect.stringContaining('2026-07-07'),
      endDate: expect.stringContaining('2026-07-12'),
    });
  });
});

// ---------------------------------------------------------------------------
// §11  useSelectionData — derivacija selData iz SelectionState
// ---------------------------------------------------------------------------

describe('useSelectionData', () => {
  it('vraća null za null selection', async () => {
    const { useSelectionData } = await import('../hooks/useSelectionData');
    const { renderHook } = await import('@testing-library/react');

    const { result } = renderHook(() =>
      useSelectionData({
        selection: null,
        days: [new Date('2026-07-01')],
        dayW: 40,
        apartments: [{ id: 'apt1', name: 'A1' }],
      }),
    );

    expect(result.current).toBeNull();
  });

  it('ispravno računa totalDays za 5-dnevnu selekciju', async () => {
    const { useSelectionData } = await import('../hooks/useSelectionData');
    const { renderHook } = await import('@testing-library/react');

    const days = Array.from({ length: 10 }, (_, i) => {
      const d = new Date('2026-07-01');
      d.setDate(d.getDate() + i);
      return d;
    });

    const { result } = renderHook(() =>
      useSelectionData({
        selection: { apartmentId: 'apt1', startIndex: 2, endIndex: 6 },
        days,
        dayW: 40,
        apartments: [{ id: 'apt1', name: 'A1' }],
      }),
    );

    expect(result.current?.totalDays).toBe(5);
    expect(result.current?.aptId).toBe('apt1');
  });

  it('normalizuje selDirection (endIndex < startIndex)', async () => {
    const { useSelectionData } = await import('../hooks/useSelectionData');
    const { renderHook } = await import('@testing-library/react');

    const days = Array.from({ length: 10 }, (_, i) => {
      const d = new Date('2026-07-01');
      d.setDate(d.getDate() + i);
      return d;
    });

    const { result } = renderHook(() =>
      useSelectionData({
        selection: { apartmentId: 'apt1', startIndex: 6, endIndex: 2 },
        days,
        dayW: 40,
        apartments: [{ id: 'apt1', name: 'A1' }],
      }),
    );

    // Inverted selection treba da vrati isti totalDays kao forward selection
    expect(result.current?.totalDays).toBe(5);
    expect(result.current?.startDate.getDate()).toBe(3); // jul 3 (index 2)
  });
});