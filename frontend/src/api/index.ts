// =============================================================================
// 🌐 frontend/src/api/index.ts
// =============================================================================
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │  CENTRALIZOVANI HTTP KLIJENT                                            │
// │                                                                         │
// │  Jedan fetch wrapper koji svi API moduli koriste.                       │
// │  Enkapsulira: base URL, credentials, Content-Type zaglavlja.            │
// └─────────────────────────────────────────────────────────────────────────┘
//
// 🔑 ZAŠTO credentials: 'include'?
//
//   Aplikacija koristi HttpOnly kolačiće za autentikaciju (JWT token).
//   HttpOnly kolačić ne može biti pročitan JavaScript-om (zaštita od XSS),
//   ali browser ga automatski šalje uz svaki zahtev — AKO je credentials: 'include'.
//
//   Bez 'include': Browser ne šalje kolačić na cross-origin zahteve
//     → Server vidi zahtev bez tokena → 401 Unauthorized
//
//   Sa 'include': Browser šalje kolačić automatski
//     → Server verifikuje token → legitimna sesija
//
//   ⚠️  Zahteva da backend ima CORS sa credentials: true i tačan Origin.
//       Wildcard CORS (*) ne radi sa credentials — browser blokira.
//
// 📋 UPOTREBNA UPUTSTVA:
//
//   Sve API funkcije (bookings.ts, apartments.ts, auth.ts) importuju apiFetch:
//     import apiFetch from './index';
//
//   Primeri poziva:
//     const res = await apiFetch('bookings');                     // GET
//     const res = await apiFetch('bookings/123', { method: 'DELETE' });
//     const res = await apiFetch('bookings', {
//       method: 'POST',
//       body: JSON.stringify({ guest: 'Ana', ... })
//     });
//
//   apiFetch NIKAD ne baca grešku sam — vraća Response objekat.
//   Pozivalac je odgovoran za provjeru res.ok i parsiranje res.json().
//
// =============================================================================

// ── Base URL konfiguracija ────────────────────────────────────────────────────
//
// VITE_API_URL se čita iz frontend/.env fajla:
//   Development: VITE_API_URL=http://localhost:4000/api
//   Production:  VITE_API_URL=https://api.moj-sajt.com/api
//
// Fallback na localhost za slučaj da .env fajl nedostaje u development okruženju.
// U produkciji, bez VITE_API_URL, fetch bi pogodio pogrešan server — proveriti!
const API_BASE_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:4000/api';

// =============================================================================
// 🌐 apiFetch — Centralizovani fetch wrapper
// =============================================================================

/**
 * Wrapper oko nativnog `fetch` koji dodaje:
 *   - Automatski base URL (VITE_API_URL iz .env)
 *   - `credentials: 'include'` za HttpOnly kolačiće (autentikacija)
 *   - `Content-Type: application/json` kao default zaglavlje
 *
 * @param endpoint - Relativna putanja BEZ početne kose crte (npr. `'bookings/123'`)
 * @param options  - Standardne fetch RequestInit opcije (method, body, headers...)
 * @returns        - Nativni Response objekat — provjeri `.ok` u pozivaocu
 *
 * @example
 * // Čitanje
 * const res = await apiFetch('apartments');
 * const data = await res.json(); // { apartments: [...] }
 *
 * @example
 * // Kreiranje sa custom body
 * const res = await apiFetch('bookings', {
 *   method: 'POST',
 *   body: JSON.stringify({ guest: 'Marko', startDate: '...' }),
 * });
 * if (!res.ok) throw new Error((await res.json()).error);
 *
 * @example
 * // Pregaženje Content-Type za FormData upload (multipart)
 * const res = await apiFetch('upload', {
 *   method: 'POST',
 *   body: formData,
 *   headers: {}, // Prazan objekat — browser postavlja boundary automatski
 * });
 */
const apiFetch = async (endpoint: string, options: RequestInit = {}): Promise<Response> => {
  // Čistimo početnu kosu crtu ako je slučajno prosleđena
  // apiFetch('/bookings') i apiFetch('bookings') daju isti rezultat
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
  const fullUrl = `${API_BASE_URL}/${cleanEndpoint}`;

  const response = await fetch(fullUrl, {
    ...options,

    // ⚠️  OBAVEZNO: Bez ovoga, browser ne šalje HttpOnly kolačić
    //     na cross-origin zahteve (različit port = cross-origin)
    credentials: 'include',

    headers: {
      // Default: JSON API komunikacija
      'Content-Type': 'application/json',
      // Pozivalac može pregasiti zaglavlja — npr. za FormData upload
      ...options.headers,
    },
  });

  return response;
};

export default apiFetch;
