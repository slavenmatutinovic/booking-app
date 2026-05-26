// =============================================================================
// 📡 frontend/src/utils/remoteLogger.ts
// =============================================================================
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  LOGGER KOJI ŠALJE GREŠKE NA BACKEND                                    │
// │                                                                         │
// │  Frontend greške su inače "nevidljive" — nestaju u korisnikovom         │
// │  browseru bez traga. Ovaj modul ih šalje na POST /api/logs             │
// │  gde ih Pino logger sprema na disk (aplikacija.log).                   │
// └─────────────────────────────────────────────────────────────────────────┘
//
// 🔄 TOK PODATAKA:
//
//   Frontend greška (npr. 409 Conflict)
//       │
//       ▼
//   remoteLogger({ level: 'error', message: 'Konflikt termina', ... })
//       │
//       ▼
//   POST /api/logs  (sa rate limiterom: max 30/min)
//       │
//       ▼
//   backend/logRoutes.ts → Pino logger → aplikacija.log
//
// ⚠️  BEZBEDNOSNE NAPOMENE:
//
//   1. Ne loguj lozinke, pun JWT token, PAN (kartice) ili medicinske podatke.
//
//   2. Email adresa: loguj je samo u `warn`/`error` kada je neophodna.
//      Za `info` logove, koristiti samo userId ili requestId.
//
//   3. url: window.location.href se šalje automatski — ako URL sadrži
//      query parametre sa osjetljivim podacima (?token=...), filtrirati.
//
//   4. errorDetails se šalje sirov — nikad ne stavljaj lozinke tu.
//
// 🚀 PERFORMANCE NAPOMENA:
//
//   remoteLogger je async ali se u nekim mjestima poziva bez await.
//   Za INFO logove ovo je željeno ponašanje (fire & forget — ne blokira UI).
//   Za ERROR logove razmotri await ako je važno da log stigne pre nego
//   što korisnik napusti stranicu (npr. pri grešci koja vodi na redirect).
//
//   Primjer fire & forget (preporučeno za info):
//     remoteLogger({ level: 'info', message: 'GET /api/bookings' }).catch(console.error);
//
//   Primjer sa await (za kritične greške):
//     await remoteLogger({ level: 'error', message: 'Pad aplikacije', errorDetails: err });
//
// =============================================================================

// =============================================================================
// 📋 TIPOVI
// =============================================================================

interface RemoteLogPayload {
  /** Ozbiljnost loga — određuje Pino metodu na backendu */
  level: 'info' | 'warn' | 'error';
  /** Kratka poruka — vidljiva u log fajlu, max 500 karaktera (backend truncuje) */
  message: string;
  /**
   * Opcioni kontekst — može biti string, Error, ili objekat sa detaljima.
   *
   * Primeri:
   *   errorDetails: { bookingId: '123', conflictWith: '456' }
   *   errorDetails: new Error('Timeout')
   *   errorDetails: 'Korisnički unos nije validan'
   *
   * ⚠️  Ne stavljati lozinke, tokene ili PII (Personally Identifiable Information).
   */
  errorDetails?: unknown;
}

// =============================================================================
// 📡 LOGGER FUNKCIJA
// =============================================================================

/**
 * Šalje log poruku na backend (POST /api/logs) i opciono u browser konzolu.
 *
 * Nikad ne baca grešku — ako backend nije dostupan, greška se loguje
 * samo u browser konzolu. Ne smemo srušiti aplikaciju zbog propuštenog loga.
 */
export const remoteLogger = async ({ level, message, errorDetails }: RemoteLogPayload): Promise<void> => {

  // ── Lokalna konzola (samo u development modu) ─────────────────────────────
  //
  // import.meta.env.DEV je Vite konstanta — u production build-u se uklanja.
  // Koristimo dinamički pristup (console[level]) umesto if/else za čistoću.
  if (import.meta.env.DEV) {
    console[level](`[Frontend] ${message}`, errorDetails ?? '');
  }

  // ── Slanje na backend ─────────────────────────────────────────────────────
  //
  // LOG_URL čita VITE_API_URL iz .env — isti base URL kao ostatak API klijenta.
  // Fallback na '/api' za slučaj da .env fajl nedostaje (relativna putanja).
  const LOG_URL = ((import.meta.env.VITE_API_URL as string) ?? '/api') + '/logs';

  try {
    await fetch(LOG_URL, {
      method: 'POST',
      credentials: 'include', // Potrebno za backend koji zahteva autentikaciju na log endpointu
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        level,
        message,
        // Error objekti se ne mogu serijalizovati JSON.stringify-om direktno —
        // koristimo .message da dobijemo string reprezentaciju
        errorDetails: errorDetails instanceof Error ? errorDetails.message : errorDetails,
        // URL stranice gdje se greška desila — korisno za debugging
        // ⚠️  PAZNJA: Ako URL sadrži osjetljive query parametre, ukloniti ih:
        // url: window.location.origin + window.location.pathname  (bez query)
        url: window.location.href,
      }),
    });
  } catch (networkError: unknown) {
    // ── Tihi fallback — backend nedostupan ───────────────────────────────────
    //
    // Ako log endpoint nije dostupan (backend pao, network greška, CORS...),
    // ne bacamo grešku dalje — to bi moglo srušiti cijeli feature koji je
    // tek pokušavao da loguje nebitnu info poruku.
    //
    // Koristimo console.error jer je ovo stvarna greška (log nije stigao),
    // ali ne propagiramo je u React tree.
    const reason = networkError instanceof Error ? networkError.message : 'Mrežna greška';
    console.error(`[remoteLogger] Slanje loga neuspešno (${level}): ${reason}`);
  }
};
