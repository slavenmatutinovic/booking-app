// backend/src/middleware/validateMiddleware.ts

import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { ApiError } from '../../../shared/index'; // Single source of truth za greške

export const validateBody = (schema: z.ZodTypeAny) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. 🔍 DINAMIČKA DETEKCIJA STRUKTURE ŠEME
      // Proveravamo da li je šema definisana sa ugnježdenim 'body' ključem (Zod v4 ugnježđene šeme)
      const isNestedBodySchema =
        'shape' in schema &&
        (schema as { shape: Record<string, unknown> }).shape.body !== undefined;

      let validatedData: unknown;

      if (isNestedBodySchema) {
        // Ako šema traži ugnježden body (npr. tvoj rate validator), šaljemo joj upakovan objekat
        validatedData = await schema.parseAsync({ body: req.body });
        // Izvlačimo podatke i čistimo transformacije nazad u Express Request
        req.body = (validatedData as { body: Record<string, unknown> }).body;
      } else {
        // ✅ ZA TVOJ LOGIN I LOGS: Pošto su šeme ravne (flat), šaljemo req.body direktno 1-na-1!
        validatedData = await schema.parseAsync(req.body);
        // Ako je šema ravna, ceo rezultat je zapravo očišćeni body
        req.body = validatedData as Record<string, unknown>;
      }
      next();
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        // Uzimamo prvu poruku iz niza grešaka za čistiji UX na frontendu
        const firstErrorMessage = error.issues[0]?.message || 'Nevalidni podaci unutar zahteva';

        const errorResponse: ApiError = { error: firstErrorMessage };
        res.status(400).json(errorResponse);
        return;
      }
      next(error);
    }
  };
};
