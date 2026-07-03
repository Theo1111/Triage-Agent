import { NextResponse } from "next/server";
import { getOperatorProfilesHealth } from "@/src/services/operatorProfiles";
import { query } from "@/src/lib/db";

export const dynamic = "force-dynamic";

// GET /api/dashboard/operators/health
// Diagnostic endpoint — confirms whether the operator_profiles table exists and
// how many profiles are stored. Useful after first deploy or migration.
//
// Example response (table ready):
//   { "ok": true, "tableExists": true, "profileCount": 2, "dbReachable": true }
//
// Example response (migration not run):
//   { "ok": false, "tableExists": false, "profileCount": 0, "dbReachable": true,
//     "hint": "Run supabase/migrations/005_operator_profiles.sql against your database,
//              or POST /api/dashboard/operators/create to auto-create the table." }

export async function GET() {
  // 1. Basic DB connectivity check
  let dbReachable = false;
  try {
    await query(`SELECT 1`);
    dbReachable = true;
  } catch (err) {
    console.error("[operators/health] DB unreachable:", err);
    return NextResponse.json(
      {
        ok: false,
        dbReachable: false,
        tableExists: false,
        profileCount: 0,
        error: "Cannot reach the database. Check DATABASE_URL.",
      },
      { status: 503 }
    );
  }

  // 2. Table existence + row count
  const { tableExists, profileCount } = await getOperatorProfilesHealth();

  return NextResponse.json({
    ok: tableExists,
    dbReachable,
    tableExists,
    profileCount,
    ...(tableExists
      ? {}
      : {
          hint: "The operator_profiles table does not exist yet. Either run supabase/migrations/005_operator_profiles.sql in your Supabase SQL editor, or simply create your first operator profile — the table will be created automatically.",
        }),
  });
}
