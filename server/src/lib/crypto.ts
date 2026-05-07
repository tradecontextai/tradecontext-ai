import crypto from 'node:crypto';
import { env } from '../config/env';

/**
 * AES-256-GCM encryption for broker API credentials at rest.
 * ENCRYPTION_KEY is a 64-char hex string (32 bytes).
 * Output format: <iv-hex>:<authTag-hex>:<cipher-hex>
 */
const KEY = Buffer.from(env.ENCRYPTION_KEY, 'hex');
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, encHex] = payload.split(':');
  if (!ivHex || !tagHex || !encHex) {
    throw new Error('Invalid encrypted payload');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

/** Cryptographically secure random hex token (default 32 bytes / 64 hex chars). */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}
