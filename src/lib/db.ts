import { Pool } from "pg";
import { env } from "@/src/config/env";

// ── Singleton pool ─────────────────────────────────────────────────────────────
//
// Stored on globalThis so it survives Next.js HMR module re-evaluations
// in development without leaking stale connections.  In production (Vercel
// serverless) globalThis and module-level vars behave identically; the
// globalThis approach makes the intent explicit and is the Next.js-recommended
// pattern for shared singleton resources.
//
// Pool sizing:
//   max: 2  — Supabase session-mode PgBouncer has pool_size: 15.  With two
//             connections per container, up to 7 warm Vercel containers can run
//             simultaneously before approaching the limit.  Do NOT increase this
//             without also switching to transaction-mode pooling.
//   idleTimeoutMillis: 10_000  — release idle connections quickly so they don't
//             accumulate across a burst of short-lived requests.
//   connectionTimeoutMillis: 5_000  — surface connection errors fast instead of
//             queuing callers indefinitely during pool exhaustion.

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function createPool(): Pool {
  const p = new Pool({
    connectionString: env.DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });
  p.on("error", (err) => {
    console.error("[db] Unexpected pool error:", err);
  });
  return p;
}

export function getDb(): Pool {
  if (!globalThis.__pgPool) {
    globalThis.__pgPool = createPool();
    console.log("[db] Created new connection pool (max=2)");
  }
  return globalThis.__pgPool;
}

// All callers use pool.query() through these helpers — the Pool class acquires
// and releases a client internally, so there are no manual connect()/release()
// calls and no risk of leaked connections.

export async function query<T extends object = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await getDb().query<T>(sql, params);
  return result.rows;
}

export async function queryOne<T extends object = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
