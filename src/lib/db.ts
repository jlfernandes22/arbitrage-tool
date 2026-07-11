import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs'

// Resolve the database path to an ABSOLUTE path so it works regardless of the
// process's current working directory. This is critical for Next.js standalone
// builds where server.js calls process.chdir(__dirname) — the CWD becomes
// .next/standalone/, so a relative DATABASE_URL like "file:./db/custom.db"
// would resolve to .next/standalone/db/custom.db (which may not exist or
// may be a stale copy).
//
// We look for db/custom.db in these locations (first match wins):
//   1. <cwd>/db/custom.db          (dev mode, or standalone with db/ copied)
//   2. <project-root>/db/custom.db  (next to package.json)
//   3. <standalone>/db/custom.db    (inside .next/standalone/)
function resolveDbPath(): string {
  const dbName = 'custom.db'
  const candidates = [
    path.join(process.cwd(), 'db', dbName),
    path.join(__dirname, '..', '..', 'db', dbName), // relative to lib/db.ts
    path.join(__dirname, '..', 'db', dbName),       // standalone layout
  ]
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return `file:${candidate}`
      }
    } catch {
      // ignore — try next candidate
    }
  }
  // Fallback: use the original DATABASE_URL (may be relative)
  return process.env.DATABASE_URL ?? 'file:./db/custom.db'
}

const databaseUrl = resolveDbPath()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: databaseUrl,
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
