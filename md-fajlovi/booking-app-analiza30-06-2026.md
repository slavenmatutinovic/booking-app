# Produkciona Analiza — Booking App

> **Datum:** 30. maj 2026.  
> **Verzija koda:** booking-app-copy26  
> **Stack:** Express 5 + Prisma 7 + PostgreSQL | React 18 + Vite + TypeScript  
> **Cilj:** Kompletna strukturalna, arhitektonska i runtime analiza, katalog bagova, redundanci i preporuke za produkcioni nivo.

---

## Sadržaj

1. [Arhitektonski pregled](#1-arhitektonski-pregled)
2. [Strukturalna analiza po slojevima](#2-strukturalna-analiza-po-slojevima)
3. [Analiza izvršavanja i performansi](#3-analiza-izvršavanja-i-performansi)
4. [Katalog bagova — od kritičnih do minornih](#4-katalog-bagova--od-kritičnih-do-minornih)
5. [Redundantan i kandidat-za-spajanje kod](#5-redundantan-i-kandidat-za-spajanje-kod)
6. [Bezbednosna analiza](#6-bezbednosna-analiza)
7. [Preporučeni features za produkcioni standard](#7-preporučeni-features-za-produkcioni-standard)
8. [Prioritizovani akcioni plan](#8-prioritizovani-akcioni-plan)

---

## 1. Arhitektonski pregled

### 1.1 Dijagram sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER                                 │
│                                                                 │
│  React 18 + Vite + TypeScript                                   │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  App.tsx │  │BookingCalendar│  │    AdminDashboard        │  │
│  │ (sesija) │  │(orkestrator)  │  │  (zahtevi gostiju)       │  │
│  └──────────┘  └──────────────┘  └──────────────────────────┘  │
│         │           │ hooks/                                    │
│         │  ┌────────┴──────────────────────────┐               │
│         │  │ useCalendarData · useDragDrop      │               │
│         │  │ useCalendarLayout · useSelectionData│              │
│         │  │ calendarActions (pure async)       │               │
│         │  └───────────────────────────────────┘               │
│         │         api/ (apiFetch wrapper)                       │
└─────────┼─────────────────────────────────────────────────────-┘
          │ HTTP + HttpOnly Cookie (JWT)
          │
┌─────────▼──────────────────────────────────────────────────────┐
│                     BACKEND (Express 5)                         │
│                                                                 │
│  server.ts → Routes → Controllers → Prisma → PostgreSQL         │
│                                                                 │
│  Middleware stack:                                              │
│  HTTPS Guard → Helmet → Compression → CORS → Rate Limiter       │
│  → optionalAuth / requireAuth / requireAdmin → Controllers      │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  /api/auth        login · logout · me                    │  │
│  │  /api/apartments  CRUD (keširan 1h)                       │  │
│  │  /api/bookings    CRUD + request pipeline                 │  │
│  │  /api/health      monitoring ping                         │  │
│  │  /api/logs        remote frontend logging                 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Utils: emailService · excelExport · cache · logger             │
│  Cron:  cleanupCron (svaki sat — EXPIRED zahtevi)               │
└────────────────────────────────────────────────────────────────┘
          │
┌─────────▼──────────────────────────────────────────────────────┐
│                     POSTGRESQL + Prisma 7                       │
│  User · Apartment · Booking · ReservationRequest                │
└────────────────────────────────────────────────────────────────┘
```

### 1.2 Tok zahteva za rezervaciju (3-fazni flow)

```
GOST                    BACKEND                     ADMIN
  │                        │                          │
  │─── POST /requests ─────▶│                          │
  │    (PENDING_EMAIL)      │                          │
  │◀── 201 + requestId ─────│                          │
  │                         │ send email to guest      │
  │◀── email: verify link ──│                          │
  │                         │                          │
  │─── GET /verify?token ──▶│                          │
  │    (mutex lock check)   │                          │
  │    (PENDING_APPROVAL)   │──── email to admin ─────▶│
  │◀── 200 HTML page ───────│                          │
  │                         │                          │
  │                         │◀── POST /approve ────────│
  │                         │    (TX + conflict check) │
  │                         │    (Booking created)     │
  │◀── confirmation email ──│                          │
```

### 1.3 Ocena arhitekture

| Oblast | Ocena | Napomena |
|--------|-------|---------|
| Slojevi (MVC + hooks) | ✅ Odlično | Jasna separacija: controllers / hooks / pure actions |
| Single Source of Truth | ✅ Odlično | `shared/index.ts` za sve domensko-relevantne tipove |
| Konkurentnost (race condition) | ✅ Odlično | Prisma TX + `FOR UPDATE` + in-memory Mutex |
| Bezbednost (authn/authz) | ✅ Solidno | HttpOnly cookie, tokenVersion, requireAdmin chain |
| Keširanje | ⚠️ Delimično | NodeCache ok, ali ključ za range queries je pogrešan |
| Error handling | ✅ Solidno | Global handler + specifični catch blokovi |
| Testabilnost | ⚠️ Delimično | Backend test postoji, frontend test fajl postoji ali pokrivenost nepoznata |
| Observability | ✅ Dobro | Pino logger + remoteLogger + health endpoint |
| Horizontalno skaliranje | ❌ Problem | In-memory Mutex i NodeCache ne rade sa više instanci |

---

## 2. Strukturalna analiza po slojevima

### 2.1 Baza podataka (Prisma schema)

**Što je dobro:**
- `Booking` ima kompozitni indeks `[apartmentId, startDate, endDate]` — optimalno za kalendar upite.
- `ReservationRequest` ima indeks `[status, expiresAt]` — bitan za cron cleanup.
- `emailToken @unique` garantuje jednokratnu upotrebu verifikacionog linka.
- `tokenVersion` na `User` modelu omogućava instantno poništavanje sesija.

**Problemi:**

```prisma
// ⚠️ PROBLEM: Booking.phone je obavezan String (ne nullable)
model Booking {
  phone  String   // ← ne String?
}

// ⚠️ PROBLEM: Apartment.description je obavezno String
model Apartment {
  description  String  // ← trebalo bi String? ili imati default ""
}

// ⚠️ PROBLEM: Nema indeksa na Booking.createdAt — izvještaji po datumu kreiranja su spori
// ⚠️ PROBLEM: Nema soft-delete na Apartment — historical rezervacije ostaju bez konteksta
// ⚠️ PROBLEM: Nema price/notes/source polja — nedostaju za produkcioni booking sistem
```

### 2.2 Backend — Controllers

Kontroleri su pravilno razdvojeni po odgovornostima:

| Fajl | Odgovornost | Kvalitet |
|------|-------------|---------|
| `auth.controller.ts` | Login, logout, /me | ✅ Čisto |
| `createBooking.controller.ts` | POST rezervacija + approve request | ✅ Solidno |
| `getBookings.controller.ts` | GET sa paginacijom i filterima | ✅ Solidno |
| `bookings.controller.ts` | PATCH + DELETE (soft) | ✅ Solidno |
| `guestRequests.controller.ts` | Kreiranje zahteva + email verify | ⚠️ Sadrži bag |
| `adminRequests.controller.ts` | Pregled i odbijanje zahteva | ⚠️ Duplikat funkcije |
| `apartments.controller.ts` | CRUD apartmana | ⚠️ `console.error` umesto logger |

**Pozitivan pattern — transakcije:**

Sve mutacije koriste `prisma.$transaction()` sa `FOR UPDATE` row-level locking. Ovo je ispravno i sprečava race condition u konkurentnim zahtevima — retkost u Express aplikacijama.

### 2.3 Backend — Routes

`bookingsRoutes.ts` je dobro dokumentovan sa tabelom pristupa i komentarima. Jedan problem: komentar u zaglavlju pominje `/api/booking-requests` ali rute su montirane na `/api/bookings/requests` — neskladnost između dokumentacije i implementacije.

### 2.4 Frontend — Hooks arhitektura

Hooks su ispravno razdvojeni po principu jedne odgovornosti:

```
useCalendarData     → fetch, state, CRUD akcije
useCalendarLayout   → DOM mjerenje, dayW, numDays
useDragDrop         → mouse events, drag state machine
useSelectionData    → izvedeni selData iz selection state
calendarActions.ts  → čiste async funkcije (bez React-a)
```

Ovo je **izuzetno dobra** odluka — `calendarActions.ts` je testabilan bez DOM-a.

**Problem:** `useCalendarData` prima `days` array kao dependency u `useEffect`. Pošto se `days` kreira unutar iste komponente sa `useMemo`, referenca je stabilna. Međutim, ako `BookingCalendar` ikad promeni `numDays` ili `startDate` u istom renderu ciklusu, može doći do dvostrukog fetch-a. Trebalo bi razmotriti dependency samo na `startDate` i `numDays`.

### 2.5 Shared tipovi

`shared/index.ts` je pravilno postavljen kao jedina istina za domenski model. Dobra praksa. Međutim:

- `ApiBooking.phone` je `string | null | undefined` ali `Booking.phone` u bazi je `String` (required). Neskladnost između shared tipa i DB šeme.
- `BookingStatus` u shared-u nema `PENDING` — to je samo na `RequestStatus`. Ispravno.
- `CreateBookingPayload.startDate` prima `string | Date` — ovo zbunjuje, bolji bi bio uvek `string` (ISO) jer JSON ne prenosi Date objekte.

---

## 3. Analiza izvršavanja i performansi

### 3.1 Keširanje

```typescript
// Implementirano:
CACHE_KEYS.APARTMENTS     → TTL 3600s (1h)  ✅
CACHE_KEYS.BOOKINGS(...)  → TTL 1800s (30m) ⚠️  
CACHE_KEYS.PENDING_REQUESTS → TTL 600s (10m) ✅
```

**Problem sa booking cache ključem:**

```typescript
// getBookings.controller.ts — linija 73
const cacheKey = CACHE_KEYS.BOOKINGS(month, apartmentId);
//                                    ↑
// 'month' je undefined kada klijent šalje startMonth/endMonth range!
// Rezultat: cacheKey = 'bookings:all:all' za SVE range upite
// Svi range upiti dele isti ključ — pogrešni podaci se vraćaju!
```

**Fix:**
```typescript
const cacheKey = CACHE_KEYS.BOOKINGS(
  startMonth && endMonth ? `${startMonth}_${endMonth}` : month,
  apartmentId
);
```

### 3.2 Baza podataka — upiti

- **Dobro:** Kompozitni indeksi na `Booking` i `ReservationRequest` su ispravni.
- **Problem:** `requireAuth` radi DB lookup (`prisma.user.findUnique`) na **svakom zaštićenom zahtevu**. Za visok traffic ovo znači DB round-trip pri svakom API pozivu. Komentar u kodu netačno kaže "stateless JWT verifikacija" — to nije istina jer postoji DB lookup. Alternativa: Redis cache za tokenVersion po `userId`.
- **Problem:** `getApartmentById` ne keši individualne apartmane — pri svakom pozivu čita iz baze sa `bookings` relacijom.
- **Problem:** `generateBookingExcel` čita **sve** rezervacije bez limita ili paginacije. Na bazi sa 10k+ rezervacija ovo je problem memorije i CPU-a.

### 3.3 Email servis

- **Dobro:** Sve email operacije su "fire & forget" — ne blokiraju HTTP odgovor.
- **Dobro:** HTML escaping sa `escapeHtml()` sprečava XSS u email sadržaju.
- **Problem:** `createTransporter()` se poziva jednom pri pokretanju servera. Ako SMTP server nije dostupan pri startu, `transporter` ostaje `null` zauvek — nema retry mehanizma.
- **Problem:** Nema bounce/delivery tracking. Ako email ne stigne gostu, admin nema informaciju.

### 3.4 Konkurentnost i horizontalno skaliranje

```typescript
// guestRequests.controller.ts
const apartmentLocks = new Map<string, Mutex>();
```

`Mutex` iz `async-mutex` paketa je **in-memory** katanac — funkcioniše samo unutar jednog Node.js procesa. Sa više instanci servera (load balancer, Docker replicas), dva zahteva za isti apartman mogu završiti na različitim instancama i mutex ne pomaže. Za produkciju sa više instanci potreban je Redis-based distributed lock (Redlock algoritam) ili se osloniti isključivo na Prisma transakcije sa DB-level locking (koje već postoje u `createBooking`). Trenutna arhitektura **nije bezbedna** za multi-instance deployment bez ove napomene u dokumentaciji.

### 3.5 Excel backup

- **Dobro:** Debounce od 5 sekundi sprečava prevelik broj generisanja pri burst operacijama.
- **Dobro:** Automatsko brisanje starih fajlova (max 50).
- **Problem:** `generateBookingExcel` čita sve rezervacije (CONFIRMED + CANCELLED) bez paginacije. Na velikom datasetu ovo može biti memorijski problematično.
- **Problem:** Backup se čuva **na serveru** (lokalni disk). Na cloud deployment-u (Render, Fly.io) disk je efemeralan — backupi se gube pri redeploy-u. Potreban je cloud storage (S3, Cloudinary).

---

## 4. Katalog bagova — od kritičnih do minornih

---

### 🔴 KRITIČAN — BUG-01: Email verifikacija uvek vraća 404

**Fajl:** `backend/src/controllers/guestRequests.controller.ts:88` i `backend/src/routes/bookingsRoutes.ts:127`

**Opis:** Link koji se šalje gostu za email verifikaciju sadrži putanju `/api/bookings/requests/verify`, ali ruta je registrovana kao `/verify` na `bookingsRouter`, što je ekvivalentno putanji `/api/bookings/verify`. Putanja ne postoji — gost uvek dobija 404.

```typescript
// CONTROLLER — generiše pogrešan URL:
const verificationLink = `${process.env.BACKEND_URL}/api/bookings/requests/verify?token=${token}`;
//                                                                       ↑ requests/ je višak

// ROUTE — registrovana putanja:
router.get('/verify', verifyReservationEmail);
// Ovo mapira na: /api/bookings/verify  ← različito od URL-a u emailu
```

**Fix:**
```typescript
// Opcija A — promeniti URL u kodu da odgovara ruti:
const verificationLink = `${process.env.BACKEND_URL}/api/bookings/verify?token=${token}`;

// Opcija B — promeniti registraciju rute:
router.get('/requests/verify', verifyReservationEmail);
```

**Uticaj:** Ceo gost-flow za zahteve je nefunkcionalan. Nijedan gost ne može verifikovati email.

---

### 🔴 KRITIČAN — BUG-02: `updateBookingSchema` — `guest` i `email` nisu opcioni

**Fajl:** `backend/src/validators/booking.validator.ts:79-90`

**Opis:** `updateBookingSchema` je namenjeno parcijalnim PATCH zahtevima, ali polja `guest` i `email` nemaju `.optional()`. Drag-and-drop operacija šalje samo `{ startDate, endDate }` — bez `guest` i `email`. Server odbija ovaj zahtev sa Zod validacijskom greškom.

```typescript
// PROBLEM:
export const updateBookingSchema = z.object({
  guest: z.string().min(2).max(100).transform(s => s.trim()),  // ← NEMA .optional()!
  email: z.string().email().max(255).transform(s => s.toLowerCase()),  // ← NEMA .optional()!
  // ...
});
```

**Fix:**
```typescript
guest: z.string().min(2).max(100).transform(s => s.trim()).optional(),
email: z.string().email().max(255).transform(s => s.toLowerCase()).optional(),
```

**Uticaj:** Drag-and-drop pomeranje rezervacija ne funkcioniše — svaki pokušaj vraća 400 validacijsku grešku.

---

### 🟠 VISOK — BUG-03: Cache ključ ignoriše `startMonth/endMonth` range

**Fajl:** `backend/src/controllers/getBookings.controller.ts:73`

**Opis:** Kada klijent šalje `startMonth` i `endMonth` parametre (standardni slučaj u kalendaru), promenljiva `month` ostaje `undefined`. Cache ključ se generiše kao `bookings:all:all` za sve range upite bez obzira na traženi period.

```typescript
// PROBLEM: month je undefined kada se koristi startMonth/endMonth
const cacheKey = CACHE_KEYS.BOOKINGS(month, apartmentId);
// Sve range query pretrage vrate cache za 'bookings:all:all'
```

**Fix:**
```typescript
const rangeKey = startMonth && endMonth ? `${startMonth}_${endMonth}` : (month ?? 'all');
const cacheKey = CACHE_KEYS.BOOKINGS(rangeKey, apartmentId);
```

**Uticaj:** Stale podaci — promene u rezervacijama se ne prikazuju do isteka TTL (30 min). Invalidacija `invalidateBookingCache()` briše ključ, ali novi upit ponovo upisuje pogrešan ključ.

---

### 🟠 VISOK — BUG-04: `BACKEND_URL` nije u Zod env šemi

**Fajl:** `backend/src/config/env.ts` i `backend/src/controllers/guestRequests.controller.ts:88`

**Opis:** `BACKEND_URL` se koristi direktno kao `process.env.BACKEND_URL` bez Zod validacije, sa fallback-om na hardkodovani localhost. U produkciji, ako `BACKEND_URL` nije postavljen, email verifikacioni linkovi pokazuju na localhost umesto na produkcioni server.

```typescript
// PROBLEM: Direktan pristup process.env bez validacije
const verificationLink = `${process.env.BACKEND_URL || 'http://localhost:4000'}/api/bookings/verify?token=${token}`;
```

**Fix — dodati u `env.ts`:**
```typescript
BACKEND_URL: z.url('BACKEND_URL mora biti validan URL').default('http://localhost:4000'),
```

**Uticaj:** U produkciji, gosti dobijaju emailove sa localhost linkovima koji ne rade.

---

### 🟠 VISOK — BUG-05: `getPendingRequestsCount` dupliciran u dva kontrolera

**Fajl:** `guestRequests.controller.ts:226` i `adminRequests.controller.ts:49`

**Opis:** Obe funkcije imaju identičnu implementaciju. Ruta u `bookingsRoutes.ts` importuje verziju iz `guestRequests.controller.ts`, ali `adminRequests.controller.ts` izvozi svoju verziju koja se nikad ne koristi.

```typescript
// guestRequests.controller.ts — linija 226 (importovana i korišćena u rutama)
export const getPendingRequestsCount = async (...) => { /* identičan kod */ };

// adminRequests.controller.ts — linija 49 (NIKAD SE NE IMPORTUJE)
export const getPendingRequestsCount = async (...) => { /* identičan kod */ };
```

**Fix:** Obrisati duplikat iz `adminRequests.controller.ts`. Ako je nameravano da admin kontroler ima ovu funkciju, prebaciti import u ruti.

---

### 🟡 SREDNJI — BUG-06: `console.error` u `apartments.controller.ts`

**Fajl:** `backend/src/controllers/apartments.controller.ts:92` i `:179`

**Opis:** Pored `logger.error()` (Pino), postoje i `console.error()` pozivi — "Dodatni log za debagovanje". U produkciji `console.error` ide na stderr nestrukturirano, bez konteksta, bez timestamp-a, i ne može se filtrovati ni parsovati od strane log agregacionih sistema (Datadog, Grafana Loki).

```typescript
// PROBLEM:
logger.error({ err: error }, '❌ getApartments — greška u bazi');
console.error('Error in getApartments:', error); // ← UKLONITI
```

**Fix:** Ukloniti sve `console.error` pozive. Pino logger je dovoljan.

---

### 🟡 SREDNJI — BUG-07: `console.log` debug u `useDragDrop.ts`

**Fajl:** `frontend/src/hooks/useDragDrop.ts:105`

**Opis:** Debug log koji se izvršava na **svaki mousemove event** tokom drag-a — potencijalno stotine puta u sekundi. Ovo usporava UI i puni browser konzolu.

```typescript
console.log('[DRAG DIAGNOSTICS - OVERLAP CHECK]', {
  daysShifted,
  calculatedValid: isValid,
  targetStart: newStartStr,
  targetEnd: newEndStr,
});
```

**Fix:** Potpuno ukloniti ili zamotati u `if (process.env.NODE_ENV === 'development')`.

---

### 🟡 SREDNJI — BUG-08: Lažni komentar "stateless" u `requireAuth`

**Fajl:** `backend/src/middleware/authMiddleware.ts:78`

**Opis:** Komentar kaže "Ne pristupa bazi podataka — čisto stateless JWT verifikacija", ali implementacija radi `prisma.user.findUnique()` na svakom zahtevu. Ovo nije greška u funkcionisanju, ali je lažna dokumentacija koja zavodi pri code review-u.

```typescript
/**
 * Ne pristupa bazi podataka — čisto stateless JWT verifikacija.  ← LAŽE!
 */
export const requireAuth = async (...) => {
  // ...
  const dbUser = await prisma.user.findUnique(/*...*/);  // ← radi DB lookup
};
```

**Fix:** Ispraviti komentar da odražava stvarno ponašanje.

---

### 🟡 SREDNJI — BUG-09: Debug ruta `/api/test` u produkciji

**Fajl:** `backend/src/server.ts:149`

**Opis:** Test ruta koja vraća `{ message: 'Backend server radi uspešno!' }` je dostupna svim korisnicima u produkciji. Ne predstavlja sigurnosni rizik, ali je neprikladno za produkcioni server.

```typescript
app.get('/api/test', (_req, res) => {
  res.json({ message: 'Backend server radi uspešno!', timestamp: new Date().toISOString() });
});
```

**Fix:** Ukloniti ili ograničiti samo na `development` okruženje.

---

### 🟡 SREDNJI — BUG-10: `tokenVersion` dostupan u klijentskom `getMe` selectu

**Fajl:** `backend/src/controllers/auth.controller.ts:104`

**Opis:** `select` u `getMe` endpoint-u uključuje `tokenVersion: true`. Ova vrednost nikad nije potrebna klijentu — služi samo internoj bezbednosnoj logici. Slanje na klijent nije direktan bezbednosni propust, ali je loša praksa i narušava princip least privilege.

**Fix:**
```typescript
select: {
  id: true,
  email: true,
  role: true,
  createdAt: true,
  tokenVersion: true,  // ← UKLONITI iz select-a
}
```

---

### 🟡 SREDNJI — BUG-11: `days` array kao `useEffect` dependency

**Fajl:** `frontend/src/hooks/useCalendarData.ts:191`

**Opis:** `useEffect` zavisi od `[startDate, days]`. `days` je stabilan (kreira se sa `useMemo`), ali semantički je pogrešno — fetch treba biti pokrenut promenom perioda (startDate + numDays), ne samim nizom dana. Ako `days` ikad postane nestabilan, doći će do beskonačne petlje fetcha.

**Fix:**
```typescript
// Izvući numDays kao zasebnu zavisnost
const numDays = days.length;
useEffect(() => {
  // ...
}, [startDate, numDays]); // ← semantički ispravno
```

---

### 🟢 MINOR — BUG-12: `AdminDashboard` koristi `alert()` i `confirm()`

**Fajl:** `frontend/src/components/AdminDashboard.tsx:74` i `:87`

**Opis:** Native browser `alert()` i `confirm()` dijalozi blokuju JavaScript thread i izgledaju zastarelo. Aplikacija već koristi `react-hot-toast`.

**Fix:** Zameniti sa toast notifikacijama i custom confirmation modal komponentom.

---

### 🟢 MINOR — BUG-13: Prisma singleton — mrtva `else` grana

**Fajl:** `backend/src/config/prisma.ts`

**Opis:** Unutar `else` grane (kada `globalForPrisma.prisma` već postoji), postoji `if (!globalForPrisma.prisma)` provera koja nikad ne može biti `true` — upravo smo ušli u `else` jer je uslov `globalForPrisma.prisma` truthy.

```typescript
} else {
  // Ovo je mrtav kod — nikad se ne izvršava
  if (!globalForPrisma.prisma) {
    throw new Error('Prisma singleton nije inicijalizovan...');
  }
  prismaInstance = globalForPrisma.prisma;  // ← ovo je jedina linija koja radi
}
```

**Fix:** Ukloniti mrtvi `if` blok.

---

### 🟢 MINOR — BUG-14: Verifikacioni link se generiše ali ne šalje (faza 1)

**Fajl:** `backend/src/controllers/guestRequests.controller.ts:88`

**Opis:** `verificationLink` promenljiva se kreira ali se **nikad ne prosleđuje** funkciji `sendRequestReceivedToGuest()`. Email koji gost prima ne sadrži link za verifikaciju.

```typescript
const verificationLink = `...verify?token=${token}`;

// Email se šalje BEZ verificationLink-a:
sendRequestReceivedToGuest({
  id: newRequest.id,
  guest: newRequest.guest,
  // ... ostala polja
  // ← verificationLink NEDOSTAJE ovde!
}).catch(/*...*/);
```

**Fix:** Dodati `verificationLink` kao parametar u `RequestEmailData` interfejs i prosleđivati ga u email template.

---

## 5. Redundantan i kandidat-za-spajanje kod

### 5.1 Duplikat: `getPendingRequestsCount`

Kao što je opisano u BUG-05, identična funkcija postoji u dva kontrolera. Trebalo bi je imati samo u jednom mestu — `adminRequests.controller.ts` (semantički ispravno), i koristiti taj import u rutama.

### 5.2 Duplikat: `formatDate` funkcija

```typescript
// backend/src/utils/excelExport.ts:47
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// frontend/src/utils/dates.ts
export function formatDate(date: Date): string { /* slična logika */ }
```

Obe formatiraju `Date → 'yyyy-MM-dd'`. Frontend i backend ne dele utilse direktno, ali logika bi trebalo biti konzistentna i komentarisana.

### 5.3 Duplikat: Date-to-ISO string konverzija

Na više mesta u kodu postoji isti pattern konverzije `YYYY-MM-DD → ISO string`:

```typescript
// calendarActions.ts:66
const finalStartDateStr = `${formatDate(selData.startDate)}T00:00:00.000Z`;

// useDragDrop.ts:136
const payload = { startDate: `${finalStartStr}T00:00:00.000Z` };

// calendarActions.ts (executeMoveBooking):
const isoStartString = `${cleanStart}T00:00:00.000Z`;
```

**Preporuka:** Ekstrahovati u shared utility:
```typescript
// shared/index.ts ili frontend/src/utils/dates.ts
export function toUTCMidnight(dateStr: string): string {
  return `${dateStr.split('T')[0]}T00:00:00.000Z`;
}
```

### 5.4 Duplikat: `isoDatetime()` helper funkcija

Definisana jednom u `booking.validator.ts` i korišćena za sve schema definicije u istom fajlu — ovo je ispravno. Nema problema.

### 5.5 Duplikat: cookie opcije

```typescript
// auth.controller.ts — login
res.cookie('token', jwtToken, {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
  path: '/',
  maxAge: 2 * 60 * 60 * 1000,
});

// authMiddleware.ts — getCookieOptions()
const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: isProduction ? 'strict' as const : 'lax' as const,
});

// auth.controller.ts — logout (ručno definisane opcije)
res.clearCookie('token', { httpOnly: true, secure: ..., sameSite: ..., path: '/' });
```

Cookie opcije su definisane na tri mesta. `getCookieOptions()` u middleware-u nije korišćena u `auth.controller.ts`.

**Preporuka:** Prebaciti `getCookieOptions()` u `config/cookieOptions.ts` i importovati svuda.

### 5.6 Redundantan: Booking controller split

`bookings.controller.ts` sadrži PATCH i DELETE, `createBooking.controller.ts` sadrži POST/approve, `getBookings.controller.ts` sadrži GET. Ukupno tri fajla za jedan entitet. Ovo je opravdano jedino ako su fajlovi veći od ~300 linija (ovako su manji). Za ovu veličinu aplikacije, standardan `bookings.controller.ts` sa svim CRUD operacijama bio bi preglednije rešenje.

### 5.7 Redundantan: `BookingAPI` vs `ApiBooking`

```typescript
// frontend/src/api/bookings.ts
export interface BookingAPI { /* ... */ }

// shared/index.ts
export interface ApiBooking { /* ... */ }
```

Oba opisuju istu strukturu odgovora sa beka. `BookingAPI` u frontend API sloju je redundantan — trebalo bi koristiti samo `ApiBooking` iz shared-a.

---

## 6. Bezbednosna analiza

### 6.1 Što radi dobro

| Mehanizam | Implementacija |
|-----------|---------------|
| HttpOnly JWT cookie | ✅ Korektno — `httpOnly: true`, HTTPS-only u produkciji |
| CSRF zaštita | ✅ `sameSite: 'strict'` u produkciji, `lax` u developmentu |
| Session invalidation | ✅ `tokenVersion` inkrement pri logout-u |
| Rate limiting | ✅ Global (300/15min), login (30/15min), logs (30/1min), requests (30/15min) |
| Input validacija | ✅ Zod na svim endpointima |
| SQL injection | ✅ Prisma parametrizovani upiti, `$queryRaw` sa template literals |
| XSS u emailovima | ✅ `escapeHtml()` function |
| CORS | ✅ Whitelist sa tačnim origin-ima, ne wildcard |
| Helmet | ✅ CSP, HSTS, i ostala zaglavlja |
| Secrets | ✅ Zod validacija pri startu — `fail fast` |
| GDPR filtriranje | ✅ Javni endpoint ne vraća guest/email/phone |

### 6.2 Bezbednosni problemi

**SEC-01 — Lozinka bez rate limit tracking po korisničkom imenu**

Rate limiter je IP-based. Napadač sa botnetom (različiti IP-ovi) može probovati neograničen broj lozinki za isti nalog. Preporuka: dodati account lockout nakon N neuspešnih pokušaja (npr. 10) sa exponential backoff.

**SEC-02 — Bearer token fallback u `requireAuth`**

```typescript
if (!token && req.headers.authorization?.startsWith('Bearer ')) {
  token = req.headers.authorization.split(' ')[1];
}
```

Podrška za Bearer header (za Postman/cURL) je u redu za development, ali u produkciji otvara mogućnost za CSRF napad ako neko pošalje Bearer token sa JavaScript-a. HttpOnly cookie + sameSite=strict je jedini bezbedni mehanizam. Bearer fallback treba biti disabled u produkciji.

**SEC-03 — `optionalAuth` ignoriše nevažeće tokene bez logovanja**

```typescript
} catch {
  // Nevažeći token — ignoriši, nastavi kao gost
}
```

Nevažeći ili krivotvoreni JWT tokeni prolaze bez logovanja. U produkciji, ovo bi trebalo `logger.warn()` da pomogne pri detekciji pokušaja manipulacije tokenima.

**SEC-04 — Email verifikacioni token je UUID**

`randomUUID()` generiše 128-bit random UUID. Ovo je kriptografski sigurno — nema potrebe za promenom.

**SEC-05 — Apartment delete je hard delete**

`DELETE /api/apartments/:id` je trajno brisanje. Istorijske rezervacije ostaju u bazi sa `apartmentId` koji više ne postoji (foreign key cascade). Bolja praksa bi bila soft-delete sa `deletedAt` poljem.

---

## 7. Preporučeni features za produkcioni standard

Sledeće funkcionalnosti su standard u booking sistemima i nedostaju:

### P0 — Kritično za produkciju

| Feature | Opis | Složenost |
|---------|------|-----------|
| **Cena po noći / ukupna cena** | `Booking` model treba `pricePerNight`, `totalPrice`. Bez ovoga nema faktura. | 3 dana |
| **Napomene/notes na rezervaciji** | Admin beleži specijalne zahteve gosta | 1 dan |
| **Notifikacija pri gostovom zahtevu** | BUG-14 fix — link u emailu | 1 dan |
| **Multi-instance lock** | Redis Redlock umesto in-memory Mutex | 2 dana |
| **Cloud backup** | S3/Backblaze umesto lokalnog diska za Excel | 1 dan |

### P1 — Visoko preporučeno

| Feature | Opis | Složenost |
|---------|------|-----------|
| **Dashboard sa statistikama** | Ukupna zarada, popunjenost po mesecu, top apartmani | 3 dana |
| **Pretraga rezervacija** | Filter po guest imenu, emailu, periodu | 2 dana |
| **Istorija izmena (Audit Log)** | Ko je i kada izmenio rezervaciju | 3 dana |
| **Izvoz CSV / Excel na zahtev** | Admin download dugme, ne samo auto-backup | 1 dan |
| **Pagination u AdminDashboard** | Zahtevi gostiju trenutno nema limit/cursor | 1 dan |
| **Account lockout** | N neuspešnih prijava = temp lock | 1 dan |
| **WebSocket / SSE notifikacije** | Real-time update kalendara bez polling-a | 3 dana |
| **Korisnička lista za admina** | CRUD korisnika (sada je samo seed skripta) | 2 dana |

### P2 — Korisni dodaci

| Feature | Opis | Složenost |
|---------|------|-----------|
| **Minimalán boravak (min nights)** | Apartment može imati `minNights` polje | 2 dana |
| **Sezonske cene** | Razlika u ceni za jul/avgust vs vansezona | 3 dana |
| **Booking.com / Airbnb ical import** | Sinhronizacija sa eksternim platformama | 5 dana |
| **Višejezičnost (i18n)** | Srpski/Engleski UI | 3 dana |
| **Mobile-friendly touch drag** | `useDragDrop` ne podržava touch evente | 2 dana |
| **Dark mode** | CSS varijable su dobro strukturirane za ovo | 1 dan |
| **Password reset flow** | Trenutno nema — admin mora ručno u DB | 2 dana |
| **2FA / TOTP** | Za admin nalog | 3 dana |
| **Gostujući iCal feed** | Apartman-specific calendar export (.ics) | 2 dana |
| **Povratne informacije gosta** | Email anketa 1 dan posle checkout-a | 2 dana |

---

## 8. Prioritizovani akcioni plan

### Faza 1 — Bugfixevi (pre produkcijskog deployments)

```
Redosled     Fix                                       Vreme
─────────────────────────────────────────────────────────────
1. [BUG-01]  Popraviti verify URL u email linku        30 min
2. [BUG-14]  Prosleđivati verificationLink u email     1 h
3. [BUG-02]  Dodati .optional() za guest+email         15 min
4. [BUG-04]  Dodati BACKEND_URL u env.ts schema        15 min
5. [BUG-03]  Ispraviti cache ključ za range upite      30 min
6. [BUG-07]  Ukloniti console.log iz useDragDrop       5 min
7. [BUG-06]  Ukloniti console.error iz apartments      5 min
8. [BUG-09]  Skriti /api/test rutu u produkciji        10 min
9. [BUG-10]  Ukloniti tokenVersion iz getMe select     5 min
```

### Faza 2 — Refaktorisanje (sprint 2)

```
─────────────────────────────────────────────────────────────
1. [R-05]  Spojiti cookie opcije u config/cookieOptions.ts
2. [R-01]  Ukloniti duplikat getPendingRequestsCount
3. [R-07]  Zameniti BookingAPI sa ApiBooking iz shared-a
4. [R-03]  Ekstrahovati toUTCMidnight() utility
5. [BUG-08] Ispraviti komentar u requireAuth
6. [BUG-11] Stabilizovati useEffect dependency
7. [BUG-13] Ukloniti mrtvu else granu u prisma.ts
```

### Faza 3 — Produkcioni hardening (sprint 3)

```
─────────────────────────────────────────────────────────────
1. [PERF]    Redis cache za tokenVersion (smanjiti DB load)
2. [PERF]    Redis Redlock za distribuirano zaključavanje
3. [FEAT]    Cloud storage za Excel backup (AWS S3 / Backblaze)
4. [SEC]     Account lockout posle N neuspešnih prijava
5. [SEC]     Disabled Bearer token fallback u produkciji
6. [SEC]     Logovanje nevažećih tokena u optionalAuth
7. [FEAT]    pricePerNight + totalPrice na Booking modelu
8. [FEAT]    notes polje na Booking modelu
```

### Faza 4 — Feature razvoj (iterativno)

Prema prioritetu iz sekcije 7, počevši od P0 pa prema P2.

---

## Završna ocena

```
╔══════════════════════════════════════════════════════════════════╗
║  UKUPNA OCENA KODA: 7.2 / 10                                     ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Arhitektura:         8.5/10  — Izuzetno dobra separacija        ║
║  Bezbednost:          7.0/10  — Solidna osnova, ima rupa         ║
║  Performanse:         6.5/10  — Cache bug, DB load na svaki req  ║
║  Kod kvalitet:        7.5/10  — TypeScript, Zod, clean patterns  ║
║  Robustnost:          8.0/10  — TX+locks, fire&forget emails     ║
║  Dokumentacija:       7.5/10  — Detaljni komentari, ali netačni  ║
║  Produkciona zrelost: 5.5/10  — BUG-01 blokira gost flow        ║
║                                                                  ║
║  Najveća prednost: Transakciona bezbednost (FOR UPDATE + Mutex)  ║
║  Najveći problem:  Email verifikacioni flow je kompletno broken  ║
╚══════════════════════════════════════════════════════════════════╝
```

Kod je napisan sa vidljivom pažnjom prema bezbednosti i konkurentnosti — što je retko. Sa popravkom 9 bugova iz Faze 1 (ukupno ~4-5 sati rada), aplikacija može biti deployment-ready za inicijalni beta.
