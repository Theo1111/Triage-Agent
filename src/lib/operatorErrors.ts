// Translates raw database errors from operator_profiles operations into
// user-readable messages, while keeping the original error in server logs.

export function friendlyOperatorError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  // Missing table — migration hasn't been applied yet.
  if (
    raw.includes("operator_profiles") && (raw.includes("does not exist") || raw.includes("42P01"))
  ) {
    return "Operator profile storage is not set up yet. Run the operator_profiles migration against your Supabase database.";
  }

  // Unique constraint violation — duplicate username.
  if (raw.includes("already taken") || raw.includes("duplicate key") || raw.includes("23505")) {
    return "That username is already taken. Choose a different one.";
  }

  // Connection refused / wrong DATABASE_URL.
  if (raw.includes("ECONNREFUSED") || raw.includes("connect ECONNREFUSED")) {
    return "Cannot reach the database. Check DATABASE_URL in your environment.";
  }

  // Password auth failure for the DB user itself (not the operator password).
  if (raw.includes("password authentication failed")) {
    return "Database credentials are invalid. Check DATABASE_URL.";
  }

  // Everything else — pass through as-is for now (it only appears in server logs,
  // not the browser, since routes use this to build the JSON response).
  return raw;
}
