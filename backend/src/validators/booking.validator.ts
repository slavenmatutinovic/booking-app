import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createBookingSchema, conditionalGuestSchema } from '../../../shared/validators';
import { validateBody } from '../middleware/validateMiddleware';

/**
 * 🛡️ Conditional Validation Middleware (BUG-02 Fix)
 *
 * Intercepts incoming requests during the booking creation process.
 * If 'requestId' is detected inside the request payload, it bypasses full calendar schema checks
 * and strictly runs validation over personal guest metrics to eliminate Payload Injection vectors.
 *
 * Validated inputs are safely formatted, trimmed, and overwritten back into req.body.
 */
export const validateConditionalCreate = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // Safe record structure mapping to bypass strict null pointer checks without utilizing 'any'
  const body = req.body as Record<string, unknown>;

  // Check if an administrative request approval chain is running
  if (body && typeof body.requestId === 'string' && body.requestId) {
    try {
      // Execute strict parsing using the shared conditional shape reflection
      const parsedGuestData = conditionalGuestSchema.parse(body);

      // Securely overwrite cleaned, transformed, and lowercased fields back into the request execution pipeline
      body.guest = parsedGuestData.guest;
      body.email = parsedGuestData.email;
      body.phone = parsedGuestData.phone;

      next(); // Data is secured and verified, pass execution directly to the controller
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validacija ličnih podataka gosta nije uspela.',
          details: error.issues,
        });
        return;
      }
      next(error);
    }
  } else {
    // If no requestId is present, it's a standard booking creation attempt.
    // We execute full validation processing over dates, capacity limits, and past-date boundaries.
    validateBody(createBookingSchema)(req, res, next);
  }
};
