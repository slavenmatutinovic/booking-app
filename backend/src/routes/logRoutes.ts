import { Router, Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger'; // Uvoz vaše Pino instance
import { frontendLogSchema } from '../validators/auth.validator'; // Zod šema za validaciju logova
import { validateBody } from '../middleware/validateMiddleware';
import { ApiError } from '../../../shared/index';

const router = Router();

/**
 * 🛡️ Brzi middleware za proveru veličine sirovog payload-a.
 * Izvršava se trenutno i štiti CPU od teških Zod parsiranja.
 */
const checkPayloadSize = (req: Request, res: Response, next: NextFunction): void => {
  // Proveravamo veličinu Content-Length zaglavlja ili stringifikovanog tela
  const contentLength = req.headers['content-length'];
  const size = contentLength ? parseInt(contentLength, 10) : JSON.stringify(req.body).length;

  if (size > 2048) {
    const errorResponse: ApiError = { error: 'Log poruka je predugačka.' };
    res.status(413).json(errorResponse);
    return;
  }
  next();
};

// 🛡️ Rate limiter specifičan za logove sa frontend-a
router.post(
  '/logs',
  checkPayloadSize,
  validateBody(frontendLogSchema),
  (req: Request, res: Response): void => {
    const parseResult = frontendLogSchema.safeParse(req.body);

    // Pošto je validateBody uspešno prošao, podaci su 100% provereni i tipizirani unutar req.body
    const { level, message, errorDetails, url } = req.body;

    // Strukturirani objekat koji šaljemo Pinu
    const logPayload = {
      frontend: true, // Zastavica da znamo da je log stigao sa klijenta
      url: url ?? 'Nije prosleđen URL',
      details: typeof errorDetails === 'object' && errorDetails !== null ? errorDetails : {},
    };

    // Dinamički biramo Pino metodu u zavisnosti od ozbiljnosti greške sa frontenda
    // Koristimo slice(0, 500) kao dodatni sloj zaštite za bazu/fajl logova
    const safeMessage = message.slice(0, 500);

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
  },
);

export default router;
