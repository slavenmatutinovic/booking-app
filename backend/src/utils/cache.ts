// backend/src/utils/cache.ts — novi fajl
import NodeCache from 'node-cache';

// TTL od 30 sekundi — dovoljno za smanjenje pritiska na bazu,
// dovoljno kratko da promene postanu vidljive brzo
export const appCache = new NodeCache({ stdTTL: 30, checkperiod: 60 });

export const CACHE_KEYS = {
  APARTMENTS: 'apartments:all',
  BOOKINGS: (month?: string) => `bookings:${month ?? 'all'}`,
} as const;
