import bcrypt from 'bcryptjs';
import { prisma } from '../config/db';
import { HttpError } from '../middleware/error';
import { randomToken } from '../lib/crypto';
import { sendWelcome, sendVerifyEmail, sendPasswordReset } from './email.service';

const BCRYPT_ROUNDS = 12;

export async function createUser(email: string, password: string) {
  const normalized = email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) throw new HttpError(409, 'Email already in use', 'EMAIL_EXISTS');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const emailVerifyToken = randomToken(24);

  const user = await prisma.user.create({
    data: {
      email: normalized,
      passwordHash,
      emailVerifyToken,
    },
    select: {
      id: true,
      email: true,
      plan: true,
      planStatus: true,
      emailVerified: true,
      createdAt: true,
    },
  });

  // Fire-and-forget — don't block signup on email delivery
  void sendWelcome({ to: user.email });
  void sendVerifyEmail({ to: user.email, token: emailVerifyToken });

  return user;
}

export async function authenticateUser(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');

  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    planStatus: user.planStatus,
    emailVerified: user.emailVerified,
  };
}

export async function startPasswordReset(email: string) {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  // Always succeed silently — don't leak which emails exist
  if (!user) return;

  const token = randomToken(24);
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: token,
      passwordResetExpires: expires,
    },
  });

  void sendPasswordReset({ to: user.email, token });
}

/** Verify an email-verification token. */
export async function verifyEmailByToken(token: string) {
  const user = await prisma.user.findFirst({ where: { emailVerifyToken: token } });
  if (!user) throw new HttpError(400, 'Invalid verification token', 'INVALID_TOKEN');
  if (user.emailVerified) return user; // already verified — idempotent
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, emailVerifyToken: null },
  });
  return user;
}

export async function completePasswordReset(token: string, newPassword: string) {
  const user = await prisma.user.findFirst({
    where: {
      passwordResetToken: token,
      passwordResetExpires: { gt: new Date() },
    },
  });
  if (!user) throw new HttpError(400, 'Invalid or expired reset token', 'INVALID_TOKEN');

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
    },
  });
}
