import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { query, queryOne } from "@/src/lib/db";

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

// ── Password helpers ───────────────────────────────────────────────────────────

async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  const buf  = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  return { hash: buf.toString("hex"), salt };
}

async function checkPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const buf     = (await scryptAsync(password, salt, KEY_LEN)) as Buffer;
  const hashBuf = Buffer.from(hash, "hex");
  if (buf.length !== hashBuf.length) return false;
  return timingSafeEqual(buf, hashBuf);
}

// ── Validation ─────────────────────────────────────────────────────────────────

function validateUsername(username: string): void {
  if (!/^[a-zA-Z0-9._-]{2,30}$/.test(username)) {
    throw new Error("Username must be 2–30 characters: letters, digits, . _ -");
  }
}

function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

export async function createOperatorProfile(input: {
  username: string;
  displayName?: string | null;
  password: string;
}): Promise<OperatorProfilePublic> {
  validateUsername(input.username);
  validatePassword(input.password);

  // Check for duplicate username (case-insensitive)
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM operator_profiles WHERE lower(username) = lower($1)`,
    [input.username]
  );
  if (existing) {
    throw new Error(`Username "${input.username}" is already taken`);
  }

  const { hash, salt } = await hashPassword(input.password);
  const row = await queryOne<OperatorProfileRow>(
    `INSERT INTO operator_profiles (username, display_name, password_hash, password_salt)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.username, input.displayName?.trim() || null, hash, salt]
  );
  if (!row) throw new Error("Failed to create operator profile");
  return { id: row.id, username: row.username, displayName: row.display_name };
}

export async function listOperatorProfiles(): Promise<OperatorProfilePublic[]> {
  const rows = await query<OperatorProfileRow>(
    `SELECT id, username, display_name FROM operator_profiles ORDER BY username`
  );
  return rows.map(r => ({ id: r.id, username: r.username, displayName: r.display_name }));
}

export async function verifyOperatorPassword(
  username: string,
  password: string
): Promise<OperatorProfilePublic | null> {
  const row = await queryOne<OperatorProfileRow>(
    `SELECT * FROM operator_profiles WHERE lower(username) = lower($1)`,
    [username]
  );
  if (!row) return null;

  const ok = await checkPassword(password, row.password_hash, row.password_salt);
  if (!ok) return null;

  await query(
    `UPDATE operator_profiles SET last_login_at = now() WHERE id = $1`,
    [row.id]
  );
  return { id: row.id, username: row.username, displayName: row.display_name };
}

export async function getOperatorProfileById(
  id: string
): Promise<OperatorProfilePublic | null> {
  const row = await queryOne<OperatorProfileRow>(
    `SELECT id, username, display_name FROM operator_profiles WHERE id = $1`,
    [id]
  );
  if (!row) return null;
  return { id: row.id, username: row.username, displayName: row.display_name };
}
