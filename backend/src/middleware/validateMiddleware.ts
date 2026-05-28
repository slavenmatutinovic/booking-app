// backend/src/middleware/validateMiddleware.ts

import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { ApiError } from '../../../shared/index'; // Single source of truth za greške

export const validateBody = (schema: z.ZodTypeAny) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // parseAsync pokreće i transformacije i .check() provere unutar Zod v4.4.3
      req.body = await schema.parseAsync(req.body);
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
