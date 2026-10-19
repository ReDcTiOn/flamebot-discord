import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { flamebotPrisma?: PrismaClient };

// В dev-режиме Next.js перезагружает модули, поэтому клиент держим в globalThis,
// чтобы не плодить подключения к базе.
export const prisma: PrismaClient =
  globalForPrisma.flamebotPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.flamebotPrisma = prisma;
}
