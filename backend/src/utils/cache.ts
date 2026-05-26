// backend/src/utils/cache.ts — JEDINI FAJL ZA KEŠ
//
// Centralizovana konfiguracija keša za celu aplikaciju.
// Svi kontroleri uvoze odavde — ne kreirati nove NodeCache instance.
//
// TTL vrednosti:
//   - apartmani: 3600s (1h) — lista se retko menja
//   - rezervacije: 1800s (30min) — menja se pri svakoj mutaciji (invalidacija!)
//
// Invalidacija keša:
//   Svaka mutacija (CREATE/UPDATE/DELETE) mora pozvati:
//     const keys = appCache.keys();
//     keys.filter(k => k.startsWith('bookings:')).forEach(k => appCache.del(k));
//   Ovo je već implementirano u bookings.controller.ts.
//
import NodeCache from 'node-cache';

export const appCache = new NodeCache({
  stdTTL: 1800, // 30 minuta — podrazumevano za rezervacije
  checkperiod: 120, // Provera isteklih ključeva svakih 2 minuta
});

export const CACHE_KEYS = {
  // Ključ za listu svih apartmana
  APARTMENTS: 'apartments:all',
  // Dinamički ključ za rezervacije po mesecu/apartmanu
  BOOKINGS: (month?: string, aptId?: string) => `bookings:${month ?? 'all'}:${aptId ?? 'all'}`,
} as const;
