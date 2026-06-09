// backend/src/routes/healthRoutes.ts

import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { logger } from '../utils/logger';
import { env } from '../config/env';

const router = Router();

/**
 * GET /api/health
 * Javni endpoint za monitoring platforme (Nginx, Docker, UptimeRobot).
 * Vraća 200 OK ako sve radi, ili 503 Service Unavailable ako je baza pala.
 */
router.get('/', async (req: Request, res: Response) => {
  const currentTimestamp = new Date().toISOString();

  try {
    // 1. Aktivna provera konekcije sa Postgres bazom (Brzi ping od <2ms)
    await prisma.$queryRaw`SELECT 1`;

    if (env.NODE_ENV === 'production') {
      res.status(200).json({
        status: 'UP',
        timestamp: currentTimestamp,
      });
      return;
    }

    // 2. Uspešan odgovor sa dijagnostikom
    return res.status(200).json({
      status: 'UP',
      timestamp: currentTimestamp,
      environment: env.NODE_ENV,
      version: process.env.npm_package_version || '1.0.0', // Povlači verziju iz package.json
      services: {
        database: 'HEALTHY',
        server: 'HEALTHY',
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Database communication breakdown';

    // Upisujemo grešku u log sistem za potrebe alarma na serveru
    logger.error(
      { err, timestamp: currentTimestamp },
      '🚨 [HEALTH CHECK ENGINE FAILURE] Detektovan prekid veze sa bazom podataka!',
    );

    // 3. Odgovor 503: Signal sistemu (npr. Docker-u) da restartuje kontejner ako baza padne
    return res.status(503).json({
      status: 'DOWN',
      timestamp: currentTimestamp,
      environment: env.NODE_ENV,
      error: errorMsg,
      services: {
        database: 'UNAVAILABLE',
        server: 'HEALTHY', // Express i dalje radi i odgovara, ali nema pristup podacima
      },
    });
  }
});

export default router;
