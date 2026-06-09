// =============================================================================
// 🔒 backend/src/middleware/rateLimiterMiddleware.ts (Identity-Aware Limiter)
// =============================================================================
import { Request, Response } from 'express';
import rateLimit, { Options, ipKeyGenerator } from 'express-rate-limit';
import { logger } from '../utils/logger';
import { env } from '../config/env'; // Tvoj osigurani env čuvar okruženja

// 🔒 Zajednička funkcija za preskakanje validacije (Ujednačena za sve limitere u aplikaciji)
// Više ne gleda NODE_ENV, već traži eksplicitnu komandu iz .env fajla!
const shouldSkipRateLimit = (): boolean => {
  return env.DISABLE_RATE_LIMITER === true;
};

/**
 * 🔒 IDENTITY-AWARE RATE LIMITER
 * ✅ HIGH SECURITY: Uses a hybrid identity calculation model.
 * Prioritizes the validated userId parameter for logged-in sessions,
 * and falls back onto network IP addresses for unauthenticated public guest streams.
 */
export const createIdentityRateLimiter = (options: {
  windowMs: number;
  max: number;
  message: string;
}) => {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    standardHeaders: true, // Return standard rate limit info in the Space-Limit headers
    legacyHeaders: false, // Disable X-RateLimit-* header representations

    // ✅ FIXED (BUG-08): Potpuno izbačeno rizično skeniranje NODE_ENV === 'test'!
    // Sada se koristi tvoja centralizovana i bezbedna 'shouldSkipRateLimit' funkcija
    skip: shouldSkipRateLimit,

    // 🎯 THE CRITICAL REALIGNMENT: Functional Key Generator (Bez novih interfejsa i bez 'any')
    keyGenerator: (req: Request): string => {
      // Koristimo Record<string, unknown> za čistu i legalnu TypeScript proveru uloga
      const rawUser = (req.user as Record<string, unknown>) || undefined;
      const userId = rawUser && typeof rawUser.userId === 'string' ? rawUser.userId : undefined;

      if (userId) {
        // Logged-in tracking: bound permanently to the specific user entity context
        return `rate:user:${userId}`;
      }

      // Guest tracking fallback: bound to network topological IP addresses
      // Ovo automatski normalizuje IPv4 i bezbedno maskira IPv6 pod-mreže (/64)
      return ipKeyGenerator(req.ip || 'unknown');
    },

    // Executed whenever a specific structural execution track breaches boundaries
    handler: (req: Request, res: Response, _next, options: Options): void => {
      const rawUser = (req.user as Record<string, unknown>) || undefined;
      const keyId = rawUser?.userId ? `Korisnik ID: ${rawUser.userId}` : `IP: ${req.ip}`;

      logger.warn(
        { keyId, path: req.originalUrl, windowMs: options.windowMs },
        '⚠️ Rate limit prag je probijen! Blokiranje mrežnog zahteva.',
      );

      res.status(429).json({
        error: options.message,
        retryAfterMs: options.windowMs,
      });
    },
  });
};

// ── Define Specific Rate Limiting Policies ───────────────────────────────────

// Standard operational policy protecting database mutation routes (Booking adjustments, mutations)
export const mutationRateLimiter = createIdentityRateLimiter({
  windowMs: 60 * 1000, // 1 Minute evaluation window
  max: 10, // Permit a maximum of 10 writes per user/IP per minute
  message: 'Previše uzastopnih izmena. Molimo sačekajte minut pre sledećeg pokušaja.',
});

// Highly strict policy protecting sensitive data compilation entries (Login attempts)
export const sensitiveAuthRateLimiter = createIdentityRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 Minute lockout block duration window
  max: 5, // Restrict authorization pipelines to a maximum of 5 attempts
  message: 'Previše neuspešnih pokušaja prijave. Pristup je privremeno blokiran na 15 minuta.',
});

// Pametna hibridna globalna politika koja štiti ceo API (Sprečava NAT blokade)
export const globalApiRateLimiter = createIdentityRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minuta prozor
  max: 300, // Maksimalno 300 zahteva po korisniku/IP adresi u 15 minuta
  message: 'Previše mrežnih zahteva. Pristup je privremeno ograničen na 15 minuta.',
});

// Pametna hibridna politika za zahteve gostiju (Rešava BUG-15)
// Dozvoljava maksimalno 5 zahteva u 10 minuta po korisniku ili IP adresi
export const standaloneRequestsLimiter = createIdentityRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minuta prozor
  max: 5, // Maksimalno 5 slanja zahteva
  message:
    'Previše poslatih zahteva za rezervaciju. Molimo sačekajte 10 minuta pre sledećeg pokušaja.',
});
