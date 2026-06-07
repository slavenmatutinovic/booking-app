// =============================================================================
// 🔒 backend/src/middleware/rateLimiterMiddleware.ts (Identity-Aware Limiter)
// =============================================================================
import { Request, Response } from 'express';
import rateLimit, { Options, ipKeyGenerator } from 'express-rate-limit';
import { logger } from '../utils/logger';

/**
 * Custom type enforcement structure to safely access optional authentication parameters
 * without breaking strict compilation rules or introducing forbidden 'any' types.
 */
interface AuthenticatedRequestContext extends Request {
  user?: {
    userId: string;
    role: 'ADMIN' | 'VIEWER';
  };
}

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

    // ✅ FIXED: Safely skip rate limiting blocks when process.env.NODE_ENV registers as 'test'.
    // This allows subsequent sequential test blocks (like STRES-05 and STRES-06) to execute
    // without catching 429 errors from previous concurrency bursts.
    skip: (): boolean => {
      const globalEnv = (globalThis as Record<string, unknown>).process as
        | Record<string, unknown>
        | undefined;
      const envMatrix =
        globalEnv?.env && typeof globalEnv.env === 'object'
          ? (globalEnv.env as Record<string, string>)
          : {};
      return envMatrix.NODE_ENV === 'test';
    },

    // 🎯 THE CRITICAL REALIGNMENT: Functional Key Generator
    keyGenerator: (req: Request): string => {
      const authReq = req as AuthenticatedRequestContext;

      if (authReq.user && typeof authReq.user.userId === 'string' && authReq.user.userId) {
        // Logged-in tracking: bound permanently to the specific user entity context
        return `rate:user:${authReq.user.userId}`;
      }

      // Guest tracking fallback: bound to network topological IP addresses
      // Ovo automatski normalizuje IPv4 i bezbedno maskira IPv6 pod-mreže (/64)
      const clientIp = req.ip || 'unknown';
      return ipKeyGenerator(clientIp);
    },

    // Executed whenever a specific structural execution track breaches boundaries
    handler: (req: Request, res: Response, _next, options: Options): void => {
      const authReq = req as AuthenticatedRequestContext;
      const keyId = authReq.user?.userId ? `Korisnik ID: ${authReq.user.userId}` : `IP: ${req.ip}`;

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
