// =============================================================================
// 🧪 e2e/bookingFlow.spec.ts — DEO 1 od 2 (Playwright E2E Test)
// =============================================================================
import { test, expect, ChromiumBrowserContext } from '@playwright/test';

// Konstante za testne rute i striktne UTC datume [BUG-04, BUG-10]

const BACKEND_URL = 'http://localhost:4000';

const TEST_GUEST = {
  name: 'Petar E2E Petrović',
  email: 'petar.e2e@example.com',
  phone: '+38164999888',
  startDate: '2027-10-15', // Čist string format prateći naš kalendarski standard
  endDate: '2027-10-20',
};

test.describe('Kritičan tok rezervacije: Od forme gosta do admin odobrenja', () => {
  test('Uspešan kompletan dvofazni ciklus rezervacije', async ({ browser }) => {
    // 1. Kreiramo izolovan kontekst browsera za Gosta
    const guestContext = await browser.newContext({ locale: 'sr-RS' });
    const guestPage = await guestContext.newPage();

    // ── FAZA 1: GOST ŠALJE ZAHTEV SA JAVNOG KALENDARA ────────────────────────
    await guestPage.goto('/calendar');
    await expect(guestPage).toHaveTitle(/Kalendar/i);

    // Otvaranje forme za slanje zahteva klikom na slobodne datume
    // (Simuliramo popunjavanje input polja forme na klijentu)
    await guestPage.locator('input[name="guestName"]').fill(TEST_GUEST.name);
    await guestPage.locator('input[name="guestEmail"]').fill(TEST_GUEST.email);
    await guestPage.locator('input[name="guestPhone"]').fill(TEST_GUEST.phone);
    await guestPage.locator('input[name="startDate"]').fill(TEST_GUEST.startDate);
    await guestPage.locator('input[name="endDate"]').fill(TEST_GUEST.endDate);

    // Slanje forme - okida se standaloneRequestsLimiter i createBookingRequest
    await guestPage.locator('button[type="submit"]').click();

    // Proveravamo da li je Toaster uspešno iscrtao uspeh na frontendu [BUG-13]
    const toastSuccess = guestPage.locator('.hot-toast-success');
    await expect(toastSuccess).toBeVisible();
    await expect(toastSuccess).toContainText(/Zahtev za rezervaciju uspešno poslat/i);

    // ── FAZA 2: SIMULACIJA EMAIL VERIFIKACIJE (FAZA 2 BEKA) ──────────────────
    // Pošto u E2E testu ne možemo stvarno otvoriti email sanduče, direktno šaljemo
    // upit na backend bazu da izvučemo tajno generisani UUID token [BUG-06]
    // Ovo radimo preko bezbednog API endpointa ili direktnog Prisma upita u testu
    const apiTokenResponse = await guestContext.request.get(
      `${BACKEND_URL}/api/tests/get-latest-token?email=${TEST_GUEST.email}`,
    );
    expect(apiTokenResponse.ok()).toBeTruthy();

    const tokenData = (await apiTokenResponse.json()) as Record<string, string>;
    const emailToken = tokenData.token;
    expect(emailToken).toBeDefined();

    // Gost klika na verifikacioni link (Otvara se u novoj kartici)
    const verifyPage = await guestContext.newPage();
    await verifyPage.goto(`${BACKEND_URL}/api/bookings/verify?token=${emailToken}`);

    // Proveravamo HTML šablon koji vraća naš verifyReservationEmail kontroler
    await expect(verifyPage.locator('h1')).toContainText('Email uspešno verifikovan');

    // ── FAZA 3: ADMIN OTVARA DASHBOARD I ODOBRAVA REZERVACIJU ────────────────
    // Kreiramo potpuno nov, izolovan kontekst prozora za Administratora (Multi-context)
    // Ovo garantuje da se kolačići sesije gosta i admina ne mešaju u memoriji
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    // Admin otvara stranicu za prijavu
    await adminPage.goto(`/login`);
    await adminPage.locator('input[type="email"]').fill('admin@example.com');
    await adminPage.locator('input[type="password"]').fill('ispravna_admin_lozinka_123');
    await adminPage.locator('button[type="submit"]').click();

    // Nakon uspešne prijave, admin se nalazi na kalendaru i vidi zeleno dugme [BUG-04]
    await expect(adminPage).toHaveURL(`/calendar`);

    // Značka (badge) na dugmetu za zahteve mora da se ažurira preko getPendingRequestsCount
    const requestsBadge = adminPage.locator('.btn-primary');
    await expect(requestsBadge).toContainText('Zahtevi na čekanju');

    // Admin prelazi na zasebnu stranicu sa tabelom zahteva gostiju
    await adminPage.goto(`/admin/requests`);

    // Pronalazimo red u tabeli koji pripada našem E2E gostu
    const guestRow = adminPage.locator('tr', { hasText: TEST_GUEST.name });
    await expect(guestRow).toBeVisible();
    await expect(guestRow.locator('.status-badge')).toContainText(/Čeka odobrenje/i);

    // Admin klikće na dugme "Odobri" (Aktivira se mutationRateLimiter i transakcija baze)
    // Kôd pokreće validateConditionalCreate i prebacuje status u CONFIRMED [N-02]
    await guestRow.locator('button.btn-approve').click();

    // Potvrda uspeha preko klijentskog Toaster-a
    const adminToast = adminPage.locator('.hot-toast-success');
    await expect(adminToast).toBeVisible();
    await expect(adminToast).toContainText(/Rezervacija uspešno potvrđena/i);

    // ── FAZA 4: VERIFIKACIJA NA GLAVNOM KALENDARU ───────────────────────────
    // Vraćamo se na kalendar da proverimo da li je in-memory keš uspešno ispražnjen
    // i da li je nova rezervacija vidljiva na timeline-u [BUG-06, N-04]
    await adminPage.goto(`/calendar`);

    // Tražimo iscrtani blok (bar) rezervacije sa imenom gosta na kalendarskoj mreži
    const bookingBar = adminPage.locator('.calendar-booking-bar', { hasText: TEST_GUEST.name });
    await expect(bookingBar).toBeVisible();

    // Čišćenje prozora i zatvaranje sesija
    await guestContext.close();
    await adminContext.close();
  });
});
