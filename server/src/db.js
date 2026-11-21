import './env.js'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis

export const prisma =
  globalForPrisma.__yueqiuPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.__yueqiuPrisma = prisma
