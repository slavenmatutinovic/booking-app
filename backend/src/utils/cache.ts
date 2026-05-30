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
import { logger } from './logger';

export const appCache = new NodeCache({
  stdTTL: 1800, // 30 minuta — podrazumevano za rezervacije
  checkperiod: 120, // Provera isteklih ključeva svakih 2 minuta
});

export const CACHE_KEYS = {
  // Ključ za listu svih apartmana
  APARTMENTS: 'apartments:all',
  // Dinamički ključ za rezervacije po mesecu/apartmanu
  BOOKINGS: (month?: string, aptId?: string) => `bookings:${month ?? 'all'}:${aptId ?? 'all'}`,
  // 📬  Statički ključ za listu i broj zahteva na čekanju
  PENDING_REQUESTS: 'requests:pending:all',
} as const;

/**
 * 🟢 POBOLJŠANJE-04: Centralized Eviction Engine
 * Scans RAM indices and flushes all variant strings sharing the "bookings:" namespace prefix
 */
export function invalidateBookingCache(): void {
  // Extract all keys currently stored inside memory buffer layers
  const activeKeys = appCache.keys();
  try {
    // Filter for structural variants (matches bookings:all:all, bookings:2026-05:all, etc.)
    const targetedBookingKeys = activeKeys.filter((key) => key.startsWith('bookings:'));

    // Evict matched keys atomically out of RAM storage arrays
    targetedBookingKeys.forEach((key) => appCache.del(key));
    logger.debug(
      `[CACHE ENGINE] Evicted ${targetedBookingKeys.length} stale booking keys from RAM.`,
    );
  } catch (cacheErr) {
    // Greška u kešu ne sme da sruši kreiranje rezervacije, samo je logujemo
    logger.error({ err: cacheErr }, '⚠️ Greška prilikom brisanja keša rezervacija');
  }
}
