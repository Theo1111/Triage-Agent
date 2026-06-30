import { query, queryOne } from "@/src/lib/db";
import type { MonitoredInbox } from "@/src/types/database";

export async function findByEmail(email: string): Promise<MonitoredInbox | null> {
  return queryOne<MonitoredInbox>(
    "SELECT * FROM monitored_inboxes WHERE email_address = $1 AND is_active = true",
    [email]
  );
}

export async function findById(id: string): Promise<MonitoredInbox | null> {
  return queryOne<MonitoredInbox>("SELECT * FROM monitored_inboxes WHERE id = $1", [id]);
}

export async function findAllActive(): Promise<MonitoredInbox[]> {
  return query<MonitoredInbox>("SELECT * FROM monitored_inboxes WHERE is_active = true ORDER BY created_at ASC");
}

export async function upsert(input: {
  displayName: string;
  emailAddress: string;
  provider?: string;
  authType?: string;
  teamArea?: string;
}): Promise<MonitoredInbox> {
  const row = await queryOne<MonitoredInbox>(
    `INSERT INTO monitored_inboxes (display_name, email_address, provider, auth_type, team_area)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email_address) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       auth_type = EXCLUDED.auth_type,
       team_area = COALESCE(EXCLUDED.team_area, monitored_inboxes.team_area),
       is_active = true,
       updated_at = now()
     RETURNING *`,
    [
      input.displayName,
      input.emailAddress,
      input.provider ?? "gmail",
      input.authType ?? "oauth",
      input.teamArea ?? null,
    ]
  );
  if (!row) throw new Error(`Failed to upsert monitored inbox: ${input.emailAddress}`);
  return row;
}
