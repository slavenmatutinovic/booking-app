import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { env } from './env'; // Uses your validated Zod env setup
import { logger } from '../utils/logger'; // Uvoz logger-a za eventualno logovanje sporih upita ili grešaka u konekciji
// 1. Establish your global placeholder type definition
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// 2. Initialize the adapter only if the instance doesn't exist yet to save connection pools
let prismaInstance: PrismaClient;

if (!globalForPrisma.prisma) {
  // Setup the native Node-Postgres connection pool
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  // Bind it using the official Prisma 7 Postgres adapter
  const adapter = new PrismaPg(pool);

  // Build the live instance matching your logging preferences
  prismaInstance = new PrismaClient({
    adapter: adapter,
    log: env.NODE_ENV === 'development' ? [{ emit: 'event', level: 'query' }] : ['error'],
  });

  if (env.NODE_ENV === 'development') {
    // 🚀 REŠENJE: Kastujemo 'query' u any da zaobiđemo bag sa drajver adapterima,
    // a parametru 'e' dajemo tačnu Prisma strukturu kako bismo bezbedno čitali duration i query.
    (prismaInstance as any).$on('query', (e: { duration: number; query: string }) => {
      if (e.duration > 100) {
        logger.warn(`⚠️ Spor upit (${e.duration}ms): ${e.query}`);
      }
    });
  }

  // Na kraju prisma.ts, dodati graceful shutdown:
  process.on('SIGINT', async () => {
    logger.info('🛑 Zatvaranje konekcija...');
    await prismaInstance.$disconnect(); // ← prismaInstance, ne prisma
    await pool.end(); // ← zatvoriti i pool
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await prismaInstance.$disconnect();
    await pool.end();
    process.exit(0);
  });
} else {
  prismaInstance = globalForPrisma.prisma;
}

// 3. Export the functional singleton instance
export const prisma = prismaInstance;

// 4. Cache it globally during development to prevent hot-reload connection leaks
if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
