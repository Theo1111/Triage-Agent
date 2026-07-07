import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { query, queryOne } from "@/src/lib/db";
import {
  isAllowedDashboardSignupEmail,
  normalizeSignupEmail,
} from "@/src/lib/dashboardSignupPolicy";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;

function scryptAsync(password: string, salt: string, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, keylen, SCRYPT_PARAMS, (err, buf) =>
      err ? reject(err) : resolve(buf)
    )
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OperatorProfilePublic {
  id: string;
  username: string;
  displayName: string | null;
}

interface OperatorProfileRow {
  id: string;
  username: string;
  display_name: string | null;
  password_hash: string;
  password_salt: string;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

// ── Auto-init ──────────────────────────────────────────────────────────────────
// Creates the operator_profiles table if it doesn't exist yet.
// Idempotent — safe to call on every cold start.
// This means you do NOT have to run 005_operator_profiles.sql manually in dev;
// the table is created automatically on first use.

let _tableInitialized: Promise<void> | null = null;

async function initTable(): Promise<void> {
  // pgcrypto provides gen_random_uuid() — safe to re-enable if not already loaded.
  await query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  await query(`
    CREATE TABLE IF NOT EXISTS operator_profiles (
      id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      username      text        NOT NULL,
      display_name  text,
      password_hash text        NOT NULL,
      password_salt text        NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz
    )
  `);

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_profiles_username_lower
      ON operator_profiles(lower(username))
  `);

  // Add the updated_at trigger only when set_updated_at() already exists
  // (defined by migration 001). Skip silently if the function isn't there.
  await query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'set_updated_at' AND n.nspname = 'public'
      ) THEN
        DROP TRIGGER IF EXISTS trg_operator_profiles_updated_at ON operator_profiles;
        CREATE TRIGGER trg_operator_profiles_updated_at
          BEFORE UPDATE ON operator_profiles
          FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      END IF;
    END;
    $$
  `);
}

function ensureTable(): Promise<void> {
  if (!_tableInitialized) {
    _tableInitialized = initTable().catch(err => {
      console.error("[operatorProfiles] Table init failed:", err);
      _tableInitialized = null; // Allow retry on next request
      throw err;
    });
  }
  return _tableInitialized;
}

// ── Password helpers ───────────────────────────────────────────────────────────

async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  const buf  = await scryptAsync(password, salt, KEY_LEN);
  return { hash: buf.toString("hex"), salt };
}

async function checkPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const buf     = await scryptAsync(password, salt, KEY_LEN);
  const hashBuf = Buffer.from(hash, "hex");
  if (buf.length !== hashBuf.length) return false;
  return timingSafeEqual(buf, hashBuf);
}

// ── Validation ─────────────────────────────────────────────────────────────────

function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

// New signups must use a Grata email address as the username (stored lowercase).
// Existing profiles with non-email usernames are unaffected — login lookup is
// unchanged, so they keep working.
export async function createOperatorProfile(input: {
  username: string;
  displayName?: string | null;
  password: string;
}): Promise<OperatorProfilePublic> {
  await ensureTable();

  if (!isAllowedDashboardSignupEmail(input.username)) {
    console.warn(
      `[operatorProfiles] signup blocked — not an allowed Grata email: "${input.username.trim().slice(0, 100)}"`
    );
    throw new Error("Only Grata email addresses can create dashboard profiles.");
  }
  const email = normalizeSignupEmail(input.username);
  validatePassword(input.password);

  // Case-insensitive duplicate check. Same message as any other create failure
  // shape — does not confirm the account exists beyond what a signup retry shows.
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM operator_profiles WHERE lower(username) = lower($1)`,
    [email]
  );
  if (existing) {
    throw new Error("That email is already registered — try logging in instead.");
  }

  const { hash, salt } = await hashPassword(input.password);
  const row = await queryOne<OperatorProfileRow>(
    `INSERT INTO operator_profiles (username, display_name, password_hash, password_salt)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, display_name, created_at`,
    [email, input.displayName?.trim() || null, hash, salt]
  );
  if (!row) throw new Error("Insert succeeded but returned no row");
  console.log(`[operatorProfiles] signup success email=${email}`);
  return { id: row.id, username: row.username, displayName: row.display_name };
}

export async function listOperatorProfiles(): Promise<OperatorProfilePublic[]> {
  await ensureTable();
  const rows = await query<Pick<OperatorProfileRow, "id" | "username" | "display_name">>(
    `SELECT id, username, display_name FROM operator_profiles ORDER BY lower(username)`
  );
  return rows.map(r => ({ id: r.id, username: r.username, displayName: r.display_name }));
}

export async function verifyOperatorPassword(
  username: string,
  password: string
): Promise<OperatorProfilePublic | null> {
  await ensureTable();
  const row = await queryOne<OperatorProfileRow>(
    `SELECT id, username, display_name, password_hash, password_salt
     FROM operator_profiles
     WHERE lower(username) = lower($1)`,
    [username]
  );
  if (!row) return null;

  const ok = await checkPassword(password, row.password_hash, row.password_salt);
  if (!ok) return null;

  // Update last_login_at — fire and forget, don't block the response.
  query(`UPDATE operator_profiles SET last_login_at = now() WHERE id = $1`, [row.id])
    .catch(err => console.error("[operatorProfiles] last_login_at update failed:", err));

  return { id: row.id, username: row.username, displayName: row.display_name };
}

export async function getOperatorProfileById(
  id: string
): Promise<OperatorProfilePublic | null> {
  await ensureTable();
  const row = await queryOne<Pick<OperatorProfileRow, "id" | "username" | "display_name">>(
    `SELECT id, username, display_name FROM operator_profiles WHERE id = $1`,
    [id]
  );
  if (!row) return null;
  return { id: row.id, username: row.username, displayName: row.display_name };
}

// ── Diagnostics ────────────────────────────────────────────────────────────────

export async function getOperatorProfilesHealth(): Promise<{
  tableExists: boolean;
  profileCount: number;
}> {
  try {
    const row = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM operator_profiles`
    );
    return { tableExists: true, profileCount: Number(row?.count ?? 0) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("operator_profiles") || msg.includes("42P01")) {
      return { tableExists: false, profileCount: 0 };
    }
    throw err;
  }
}
