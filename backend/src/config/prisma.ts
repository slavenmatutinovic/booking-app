// =============================================================================
// Okolina koda: Vrh datoteke i uvozi (backend/src/config/prisma.ts)
// =============================================================================
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';

const globalForPrisma = globalThis as unknown as {
  prisma: any;
};

let prismaInstance: any;

if (!globalForPrisma.prisma) {
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  const adapter = new PrismaPg(pool);

  prismaInstance = new PrismaClient({
    adapter: adapter,
    // Logovanje prosleđujemo standardno na konzolu/logger samo za kritične greške baze
    log: ['error'],
  }).$extends({
    // Sloj 1: Automatizovano logovanje sporih upita u razvojnom okruženju
    query: {
      $allOperations(args) {
        // Ako smo u development modu, mjerimo precizno vrijeme izvršavanja svake operacije
        if (env.NODE_ENV === 'development') {
          const start = performance.now();

          return args.query(args.args).then((result) => {
            const duration = performance.now() - start;
            // Ako upit traje duže od 100 milisekundi, logger odmah ispaljuje upozorenje
            if (duration > 100) {
              logger.warn(
                `⚠️ Spor upit unutar modela [${args.model}] — operacija [${args.operation}] trajala je ${duration.toFixed(1)}ms`,
              );
            }
            return result;
          });
        }
        // U produkciji samo propuštamo upit bez trošenja resursa na mjerenje performansi
        return args.query(args.args);
      },
    },
    // Sloj 2: Tvoja omiljena transformacija podataka na nivou rezultata baze
    result: {
      apartmentRate: {
        price: {
          needs: { price: true },
          compute(rate: { price: Prisma.Decimal }) {
            return rate.price ? Number(rate.price) : 0;
          },
        },
        startDate: {
          needs: { startDate: true },
          compute(rate: { startDate: Date }) {
            if (!rate.startDate || isNaN(rate.startDate.getTime())) return '';
            return rate.startDate.toISOString().split('T')[0];
          },
        },
        endDate: {
          needs: { endDate: true },
          compute(rate: { endDate: Date }) {
            if (!rate.endDate || isNaN(rate.endDate.getTime())) return '';
            return rate.endDate.toISOString().split('T')[0];
          },
        },
      },
    },
  });

  if (env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prismaInstance;
  }

  // Graceful shutdown logika za oslobađanje resursa pool-a i klijenta pri gašenju aplikacije
  process.on('SIGINT', async () => {
    logger.info('🛑 Zatvaranje konekcija...');
    await prismaInstance.$disconnect();
    await pool.end();
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

// =============================================================================
// KONAČNO UKLOPENO I SIGURNO RJEŠENJE: Top-level izvoz proširenog klijenta
// i njegovog strogog transakcijskog sučelja koji ne uzrokuju pogreške.
// =============================================================================
export const prisma = prismaInstance as typeof prismaInstance;

// Transakcijski klijent preuzima uobičajene modele, ali za apartmentRate koristi naš strogi transformirani oblik
export type ExtendedTransactionClient = Omit<Prisma.TransactionClient, 'apartmentRate'> & {
  apartmentRate: (typeof prisma)['apartmentRate'];
};
