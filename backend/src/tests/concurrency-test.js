// backend/concurrency-test.js

const BACKEND_URL = 'http://localhost:4000/api'; // Prilagodi svom portu
const TOTAL_REQUESTS = 20;

// Zamjenski podaci za testiranje — prilagodi ID-jeve onima koje stvarno imaš u svojoj bazi
const TEST_PAYLOAD = {
  requestId: 'cmpoec5e600053cttinfr1o3j', // ID zahteva koji već postoji i čeka odobrenje (ako testiraš odobrenje)
  // Ili ako testiraš direktno kreiranje rezervacije (POST /api/bookings):
  apartmentId: 'cmpg1vkkf0005ogttyus138l6', // ID apartmana koji već postoji u bazi
  guest: 'Stres Test Gost',
  email: 'stres@test.com',
  phone: '+38160123456',
  startDate: '2026-10-15T00:00:00.000Z',
  endDate: '2026-10-20T00:00:00.000Z',
};

// Ako tvoja ruta zahtijeva admin login, ovde stavi autentifikacioni kolačić (token) koji uzmeš iz browsera
const COOKIE_HEADER = process.env.TEST_ADMIN_TOKEN || '';

if (!COOKIE_HEADER) {
  console.error('\n❌ CRITICAL EXCLUSION FAULT: Token credential initialization failed.');
  console.error(
    '👉 Molimo vas da postavite ispravan TEST_ADMIN_TOKEN u .env.test fajl pre pokretanja testa!\n',
  );
  process.exit(1);
}

async function runConcurrencyTest() {
  console.log(`🚀 Pokrećem stres test: Ispaljujem ${TOTAL_REQUESTS} istovremenih zahtjeva...`);
  console.log(`📅 Termin: ${TEST_PAYLOAD.startDate} → ${TEST_PAYLOAD.endDate}\n`);

  // Kreiramo niz obećanja (promises) kako bismo ih ispalili u ISTOM trenutku
  const requests = Array.from({ length: TOTAL_REQUESTS }).map((_, index) => {
    return fetch(`${BACKEND_URL}/bookings/requests`, {
      // Promijeni putanju u /bookings/requests/approve ako testiraš odobrenje
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: COOKIE_HEADER, // Šaljemo sesiju admina
      },
      body: JSON.stringify(TEST_PAYLOAD),
    })
      .then(async (res) => {
        const data = await res.json();
        return {
          id: index + 1,
          status: res.status,
          data,
        };
      })
      .catch((err) => {
        return {
          id: index + 1,
          status: 'CRASH',
          data: err.message,
        };
      });
  });

  // KORAK 1: Ispaljujemo sve zahteve paralelno u istom milisekund (Promise.all)
  const startTime = Date.now();
  const results = await Promise.all(requests);
  const duration = Date.now() - startTime;

  console.log(`⏱️ Svi zahtjevi obrađeni za ${duration}ms.\n`);

  // KORAK 2: Analiza rezultata
  let uspešni = 0;
  let odbijeni = 0;
  let srušeni = 0;

  results.forEach((res) => {
    if (res.status === 201 || res.status === 200) {
      uspešni++;
      console.log(`✅ Zahtjev #${res.id}: USPEO (Status: ${res.status})`);
    } else if (res.status === 'CRASH') {
      srušeni++;
      console.log(`💥 Zahtjev #${res.id}: MREŽNI KRAH — ${res.data}`);
    } else {
      odbijeni++;
      console.log(
        `❌ Zahtjev #${res.id}: ODBIJEN (Status: ${res.status}) — Poruka: ${res.data.error || JSON.stringify(res.data)}`,
      );
    }
  });

  console.log('\n📊 FINALNI IZVEŠTAJ STRES TESTA:');
  console.log(`─────────────────────────────────`);
  console.log(`🟢 Uspešnih rezervacija: ${uspešni}  (Očekivano: 1)`);
  console.log(`🔴 Bezbjedno odbijenih:  ${odbijeni}  (Očekivano: ${TOTAL_REQUESTS - 1})`);
  console.log(`💥 Mrežnih krahova:      ${srušeni}  (Očekivano: 0)`);
  console.log(`─────────────────────────────────`);

  if (uspešni === 1) {
    console.log('🏆 TEST USPEŠAN: Baza je savršeno odbranila integritet! Nema duplih rezervacija.');
  } else if (uspešni > 1) {
    if (uspešni === 5) {
      console.log(
        '🏆 TEST USPEŠAN: Mutex je savršeno odbranio bazu! Upisano je tačno 5 zahteva, ostali su bezbedno odbijeni.',
      );
    } else if (uspešni > 5) {
      console.log('🚨 ALARM: Pronađen RACE CONDITION! Upisano je više od 5 zahteva u isti termin.');
    } else {
      console.log('⚠️ PAŽNJA: Proveri slobodne termine ili validnost tokena.');
    }
  } else {
    console.log(
      '⚠️ PAŽNJA: Nijedan zahtjev nije uspeo. Proveri ID apartmana ili validnost JWT tokena.',
    );
  }
}

runConcurrencyTest();
