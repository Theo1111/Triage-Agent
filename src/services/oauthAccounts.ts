import { exchangeCode, createAuthenticatedClient } from "@/src/lib/google/oauth";
import * as oauthRepo from "@/src/repositories/oauthAccountsRepository";
import * as inboxesRepo from "@/src/repositories/monitoredInboxesRepository";
import { google } from "googleapis";
import type { MonitoredInbox, OauthAccount } from "@/src/types/database";

export async function connectGoogleAccount(code: string): Promise<{
  inbox: MonitoredInbox;
  account: OauthAccount;
}> {
  const tokens = await exchangeCode(code);

  if (!tokens.access_token) {
    throw new Error("No access token returned from Google. Token exchange may have failed.");
  }

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token returned. The consent screen may not have shown, or access was already granted. " +
        "Revoke access at https://myaccount.google.com/permissions and try again."
    );
  }

  const authClient = createAuthenticatedClient({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  });

  // gmail.readonly covers users.getProfile — no additional scopes needed.
  const gmail = google.gmail({ version: "v1", auth: authClient });
  const { data: profile } = await gmail.users.getProfile({ userId: "me" });
  const emailAddress = profile.emailAddress;

  if (!emailAddress) throw new Error("Could not retrieve email address from Gmail profile");

  console.log(`[oauth] Gmail profile fetched for ${emailAddress}`);

  // Upsert monitored inbox.
  const inbox = await inboxesRepo.upsert({
    emailAddress,
    displayName: emailAddress,
    provider: "gmail",
    authType: "oauth",
  });

  // Upsert OAuth account — refresh_token is preserved on conflict if not re-issued.
  const account = await oauthRepo.upsert({
    monitoredInboxId: inbox.id,
    provider: "google",
    providerAccountEmail: emailAddress,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    scope: tokens.scope ?? null,
    tokenType: tokens.token_type ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  });

  console.log(`[oauth] Connected ${emailAddress} (inbox=${inbox.id})`);
  return { inbox, account };
}
