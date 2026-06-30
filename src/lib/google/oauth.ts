import { google } from "googleapis";
import { env } from "@/src/config/env";
import { GMAIL_SCOPES } from "@/src/config/gmail";

export function createOAuthClient() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI
  );
}

export function buildAuthUrl(): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: GMAIL_SCOPES,
    // Force consent screen so we always get a refresh token.
    prompt: "consent",
  });
}

export async function exchangeCode(code: string) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

// Returns an OAuth2Client loaded with stored credentials for a given inbox.
// Automatically refreshes access token if expired.
export function createAuthenticatedClient(input: {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
}) {
  const client = createOAuthClient();
  client.setCredentials({
    access_token: input.accessToken ?? undefined,
    refresh_token: input.refreshToken ?? undefined,
    expiry_date: input.expiresAt ? input.expiresAt.getTime() : undefined,
  });
  return client;
}
