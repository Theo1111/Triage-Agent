import { Pool } from "pg";
import { env } from "@/src/config/env";

// Singleton pool — shared across requests in the same Node process.
let pool: Pool | null = null;

export function getDb(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      // Keep connections alive between serverless invocations when possible.
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    pool.on("error", (err) => {
      console.error("[db] Unexpected pool error:", err);
    });
  }
  return pool;
}

// Convenience wrapper for single-query use.
export async function query<T extends object = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const db = getDb();
  const result = await db.query<T>(sql, params);
  return result.rows;
}

// Returns the first row or null.
export async function queryOne<T extends object = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
