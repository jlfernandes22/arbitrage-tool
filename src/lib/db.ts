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

// `let` (not `const`): reconnect() replaces the client after a transient
// SQLite failure. ES module live bindings mean every `import { db }` caller
// automatically sees the fresh client on their next operation.
export let db = new PrismaClient({
  datasourceUrl: databaseUrl,
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// ── Transient write-failure recovery ────────────────────────────────────────
// SQLite can transiently fail writes with "attempt to write a readonly
// database" (SQLITE_READONLY_ROLLBACK, extended code 1032) when a hot journal
// from an interrupted transaction needs rollback, or with "database is
// locked" under concurrent writers. These almost always clear on a fresh
// connection. Without this recovery, persistTask-style callers silently lost
// entire scan results from history.
const TRANSIENT_WRITE_ERRORS =
  /readonly database|database is locked|SQLITE_READONLY|SQLITE_BUSY/i

function isTransientWriteError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return TRANSIENT_WRITE_ERRORS.test(msg)
}

function makeClient(): PrismaClient {
  return new PrismaClient({
    datasourceUrl: databaseUrl,
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Run a DB write (or read) operation with automatic recovery from transient
 * SQLite failures. Retries up to `retries` times: each retry first forces a
 * fresh Prisma connection (clearing any stale/hot-journal connection state),
 * then re-runs the operation. Use for ALL durability-critical writes
 * (persisting scan results, config edits, forex cache) — not for hot-path
 * reads where failing fast is preferable.
 */
export async function withDbWriteRetry<T>(
  op: () => Promise<T>,
  retries = 2,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await op()
    } catch (e) {
      lastError = e
      if (!isTransientWriteError(e) || attempt === retries) break
      console.warn(
        `[db] transient SQLite write failure (attempt ${attempt + 1}/${retries + 1}): ` +
          `${e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)} — reconnecting and retrying`,
      )
      // Force a brand-new connection: the old client may hold the stale
      // connection that hit the hot journal / lock.
      try {
        await db.$disconnect()
      } catch {
        // ignore — the old connection may already be dead
      }
      db = makeClient()
      if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
      await sleep(250 * (attempt + 1)) // brief backoff: 250ms, 500ms
    }
  }
  throw lastError
}
