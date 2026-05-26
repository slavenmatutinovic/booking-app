import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma'; // Koristiti singleton, ne new PrismaClient()
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { loginSchema } from '../validators/auth.validator';

// ─── POST /api/auth/login ──────────────────────────────────────────────────────
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  logger.debug({ body: { email: req.body?.email } }, '🔐 Login pokušaj');

  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message ?? 'Neispravan unos';
      logger.warn({ errors: parseResult.error.issues }, '⚠️ Login validacija neuspešna');
      res.status(400).json({ error: firstError });
      return;
    }

    // ✅ ISPRAVKA NOV-03: Koristiti parseResult.data, NE req.body!
    const { email, password } = parseResult.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      logger.warn({ email }, '⚠️ Login neuspešan — korisnik ne postoji');
      res.status(401).json({ error: 'Pogrešni kredencijali' });
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      logger.warn({ email }, '⚠️ Login neuspešan — pogrešna lozinka');
      res.status(401).json({ error: 'Pogrešni kredencijali' });
      return;
    }

    // expiresIn kao broj sekundi (jsonwebtoken v9+ preporučuje broj)
    const jwtToken = jwt.sign(
      { userId: user.id, role: user.role, tokenVersion: user.tokenVersion },
      env.JWT_SECRET,
      {
        expiresIn: 2 * 60 * 60, // 2 sata u sekundama
      },
    );

    res.cookie('token', jwtToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
      path: '/',
      maxAge: 2 * 60 * 60 * 1000, // 2 sata u milisekundama
    });

    logger.info({ userId: user.id, email: user.email, role: user.role }, '✅ Uspešna prijava');
    res.json({
      message: 'Uspešna prijava',
      user: { id: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion },
    });
  } catch (error) {
    logger.error({ err: error }, '❌ login — neočekivana greška');
    next(error); // ← Prosleđuje grešku globalnom handleru
  }
};
// ─── POST /api/auth/logout ─────────────────────────────────────────────────────
export const logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const userId = req.user?.userId;
  if (userId) {
    logger.info({ userId }, '🚪 Korisnik se odjavio - token se poništava');

    try {
      await prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      });
    } catch (dbError) {
      // Logujemo ali NE blokiramo logout — korisnik se odjavljuje čak i ako DB pada
      logger.error({ err: dbError, userId }, '⚠️ logout — tokenVersion nije inkrementovan');
    }
  }

  res.clearCookie('token', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/',
  });
  res.json({ message: 'Odjavljeni ste' });
};

// ─── GET /api/auth/me ──────────────────────────────────────────────────────────
// Svrha: Obnavljanje sesije posle F5, provera role, prikaz email-a u headeru
export const getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  logger.debug({ userId: req.user?.userId }, '👤 GET /api/auth/me');

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        tokenVersion: true, // Dodato za proveru verzije
        // NIKAD: password — hash lozinke ne sme napustiti backend
      },
    });

    // Validacija verzije tokena iz baze i iz samog JWT payload-a
    if (!user || user.tokenVersion !== req.user!.tokenVersion) {
      logger.warn({ userId: req.user?.userId }, '⚠️ /me — token je nevažeći ili poništen (Logout)');
      res.clearCookie('token', {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      });
      res.status(401).json({ error: 'Sesija je nevažeća, prijavite se ponovo' });
      return;
    }

    logger.debug({ userId: user.id, role: user.role }, '✅ /me — sesija validna');
    res.json({ user });
  } catch (error) {
    logger.error({ err: error }, '❌ getMe — neočekivana greška');
    next(error); // ← Prosleđuje grešku globalnom handleru
  }
};
