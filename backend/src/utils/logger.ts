import pino from 'pino';
import { env } from '../config/env'; // Uvezite vaš verifikovani env sa Zod-om

// 1. Kreiramo bazičnu konfiguraciju
const config: pino.LoggerOptions = {
  level: env.NODE_ENV === 'development' ? 'debug' : 'info',
};

// 2. Dinamički dodajemo transport SAMO u developmentu
// Ovo sprečava pojavu 'undefined' vrednosti i ujedno rešava slanje u lokalni fajl
if (env.NODE_ENV === 'development') {
  config.transport = {
    target: 'pino/file',
    options: {
      // Lokacija gde će se na vašem računaru kreirati log fajl (u korenu projekta)
      destination: './aplikacija.log',
      mkdir: true,
    },
  };
}

// 3. Inicijalizujemo loger sa čistim objektom
export const logger = pino(config);

interface FireAndForgetContext {
  action: string;
  [key: string]: unknown; // Allows safe operational payloads (e.g., bookingId, apartmentId) without 'any'
}

/**
 * ⚡Centralized Fire-and-Forget Process Handler.
 * Bypasses redundant type-checking and guarantees safe background resolution execution.
 * Intercepts failures safely and channels them to the central logging core.
 *
 * @param promise - The active background execution promise
 * @param ctx - Structured tracking metrics detailing where and why the background task was fired
 */
export function fireAndForget(promise: Promise<unknown>, ctx: FireAndForgetContext): void {
  // Directly attach the catch block. Async tasks are guaranteed promises.
  promise.catch((err: unknown) => {
    const errMsg =
      err instanceof Error ? err.message : 'Unknown asynchronous background exception.';

    // Log the intercept cleanly alongside the custom contextual parameters
    logger.error(
      { err: errMsg, ...ctx },
      `⚡ Background Task Failed during execution: [${ctx.action}]`,
    );
  });
}
