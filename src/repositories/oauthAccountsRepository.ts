import { queryOne } from "@/src/lib/db";
import type { OauthAccount } from "@/src/types/database";

export async function findByInboxId(monitoredInboxId: string): Promise<OauthAccount | null> {
  return queryOne<OauthAccount>(
    "SELECT * FROM oauth_accounts WHERE monitored_inbox_id = $1 AND provider = 'google'",
    [monitoredInboxId]
  );
}

export async function upsert(input: {
  monitoredInboxId: string;
  provider: string;
  providerAccountEmail: string;
  accessToken: string | null;
  refreshToken: string | null;
  scope: string | null;
  tokenType: string | null;
  expiresAt: Date | null;
}): Promise<OauthAccount> {
  const row = await queryOne<OauthAccount>(
    `INSERT INTO oauth_accounts
       (monitored_inbox_id, provider, provider_account_email, access_token, refresh_token, scope, token_type, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (monitored_inbox_id, provider) DO UPDATE SET
       provider_account_email = EXCLUDED.provider_account_email,
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_accounts.refresh_token),
       scope = EXCLUDED.scope,
       token_type = EXCLUDED.token_type,
       expires_at = EXCLUDED.expires_at,
       updated_at = now()
     RETURNING *`,
    [
      input.monitoredInboxId,
      input.provider,
      input.providerAccountEmail,
      input.accessToken,
      input.refreshToken,
      input.scope,
      input.tokenType,
      input.expiresAt,
    ]
  );
  if (!row) throw new Error(`Failed to upsert oauth account for inbox ${input.monitoredInboxId}`);
  return row;
}

export async function updateTokens(input: {
  id: string;
  accessToken: string;
  expiresAt: Date | null;
}): Promise<void> {
  await queryOne(
    "UPDATE oauth_accounts SET access_token = $1, expires_at = $2, updated_at = now() WHERE id = $3",
    [input.accessToken, input.expiresAt, input.id]
  );
}
