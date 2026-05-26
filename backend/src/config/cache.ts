// backend/src/config/cache.ts
import NodeCache from 'node-cache';

// Inicijalizujemo keš sa podrazumevanim trajanjem od 15 minuta (900 sekundi)
export const appCache = new NodeCache({
  stdTTL: 900,
  checkperiod: 120,
});

// Striktni tasteri (ključevi) za keširanje kako bismo izbegli greške u kucanju
export const CACHE_KEYS = {
  APARTMENTS: 'apartments_list',
  STATS: 'calendar_stats',
} as const;
