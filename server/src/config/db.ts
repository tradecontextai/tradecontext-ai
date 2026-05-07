import { PrismaClient } from '@prisma/client';
import { isProd } from './env';

/**
 * Prisma client singleton — survives hot reloads in dev.
 * In production, just one instance per process.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['error'] : ['warn', 'error'],
  });

if (!isProd) globalForPrisma.prisma = prisma;
