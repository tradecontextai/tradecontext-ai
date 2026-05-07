import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import {
  authenticateUser,
  completePasswordReset,
  createUser,
  startPasswordReset,
  verifyEmailByToken,
} from '../services/auth.service';
import {
  cookieName,
  cookieOptions,
  clearCookieOptions,
  signToken,
} from '../lib/jwt';

export const authRouter = Router();

// ──────── schemas ────────
const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(8),
});

// ──────── POST /api/auth/signup ────────
authRouter.post('/signup', async (req, res, next) => {
  try {
    const { email, password } = signupSchema.parse(req.body);
    const user = await createUser(email, password);
    const token = signToken({ sub: user.id, email: user.email });
    res.cookie(cookieName, token, cookieOptions);
    res.status(201).json({ user });
  } catch (e) {
    next(e);
  }
});

// ──────── POST /api/auth/login ────────
authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await authenticateUser(email, password);
    const token = signToken({ sub: user.id, email: user.email });
    res.cookie(cookieName, token, cookieOptions);
    res.json({ user });
  } catch (e) {
    next(e);
  }
});

// ──────── POST /api/auth/logout ────────
authRouter.post('/logout', (_req, res) => {
  res.clearCookie(cookieName, clearCookieOptions);
  res.json({ ok: true });
});

// ──────── GET /api/auth/me ────────
authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ──────── POST /api/auth/forgot-password ────────
authRouter.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = forgotSchema.parse(req.body);
    await startPasswordReset(email);
    // Always 200 — don't leak whether email exists
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ──────── POST /api/auth/reset-password ────────
authRouter.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = resetSchema.parse(req.body);
    await completePasswordReset(token, password);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ──────── POST /api/auth/verify-email ────────
const verifySchema = z.object({ token: z.string().min(20) });
authRouter.post('/verify-email', async (req, res, next) => {
  try {
    const { token } = verifySchema.parse(req.body);
    const user = await verifyEmailByToken(token);
    res.json({ ok: true, email: user.email, verified: true });
  } catch (e) {
    next(e);
  }
});
