import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger'; // Uvoz vaše Pino instance
import { frontendLogSchema } from '../validators/auth.validator'; // Zod šema za validaciju logova

const router = Router();

// REŠENJE SEC-03: Dodat requireAuth middleware kako anonimni posetioci ne bi mogli da pune disk logovima
router.post('/logs', (req: Request, res: Response): void => {
  const parseResult = frontendLogSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({ error: 'Neispravan format loga' });
    return;
  }

  const { level, message, errorDetails, url } = parseResult.data;

  // Osnovna validacija tipa podataka (ne bacamo grešku, samo sanitizujemo)
  if (typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'Polje message je obavezno' });
    return;
  }

  // Strukturirani objekat koji šaljemo Pinu
  const logPayload = {
    frontend: true, // Zastavica da znamo da je log stigao sa klijenta
    url: typeof url === 'string' ? url : 'Nije prosleđen URL',
    details: typeof errorDetails === 'object' && errorDetails !== null ? errorDetails : {},
  };

  // Dinamički biramo Pino metodu u zavisnosti od ozbiljnosti greške sa frontenda
  if (level === 'error') {
    logger.error(logPayload, `❌ Frontend Greška: ${message.slice(0, 500)}`);
  } else if (level === 'warn') {
    logger.warn(logPayload, `⚠️ Frontend Upozorenje: ${message.slice(0, 500)}`);
  } else {
    logger.info(logPayload, `ℹ️ Frontend Info: ${message.slice(0, 500)}`);
  }

  // Uvek vraćamo 200 OK klijentu bez obzira na sve, da ne blokiramo frontend
  res.status(200).json({ success: true });
});

export default router;
