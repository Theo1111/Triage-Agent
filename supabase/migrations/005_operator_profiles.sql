-- 005_operator_profiles.sql
-- Persisted dashboard operator profiles with hashed passwords.
-- Safe to run more than once (all DDL is idempotent).

-- pgcrypto provides gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- set_updated_at() is normally created by 001_email_ingestion.sql.
-- Defined here with CREATE OR REPLACE so this migration is self-contained
-- and safe to run in isolation (e.g. against a fresh schema).
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS operator_profiles (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text        NOT NULL,
  display_name  text,
  password_hash text        NOT NULL,
  password_salt text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- Case-insensitive username uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_profiles_username_lower
  ON operator_profiles(lower(username));

DROP TRIGGER IF EXISTS trg_operator_profiles_updated_at ON operator_profiles;
CREATE TRIGGER trg_operator_profiles_updated_at
  BEFORE UPDATE ON operator_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
