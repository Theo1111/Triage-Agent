import { z } from "zod";

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // App
  APP_BASE_URL: z.string().url("APP_BASE_URL must be a valid URL"),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  GOOGLE_REDIRECT_URI: z.string().url("GOOGLE_REDIRECT_URI must be a valid URL"),

  // Gmail / PubSub
  GOOGLE_PUBSUB_TOPIC: z.string().min(1, "GOOGLE_PUBSUB_TOPIC is required"),
  GOOGLE_PUBSUB_SUBSCRIPTION: z.string().min(1, "GOOGLE_PUBSUB_SUBSCRIPTION is required"),

  // Attachment storage
  ATTACHMENT_STORAGE_BUCKET: z.string().min(1, "ATTACHMENT_STORAGE_BUCKET is required"),

  // Filtering
  INTERNAL_EMAIL_DOMAINS: z.string().default(""),
  AUTOMATED_ALERT_DENYLIST: z.string().default("no-reply@,noreply@,do-not-reply@,alerts@,notifications@"),

  // Pipeline
  // Set to "true" to automatically classify + route every newly ingested email.
  AUTO_TRIAGE_NEW_EMAILS: z.string().default("false"),

  // OpenAI
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),

  // Slack (optional — set to enable shared escalation channel posting)
  SLACK_WEBHOOK_URL: z.string().optional(),
  SLACK_ESCALATION_CHANNEL_NAME: z.string().optional(),
  // Required once interactivity is enabled in the Slack app settings
  SLACK_SIGNING_SECRET: z.string().optional(),
  // Bot token (xoxb-…) — required for chat.update + chat.postMessage thread replies.
  // Scopes: chat:write, im:write
  SLACK_BOT_TOKEN: z.string().optional(),
  // Theo's Slack member ID (must be U…). Used with conversations.open to get his DM channel.
  // Find it in Slack: click profile photo → View full profile → ⋯ → Copy member ID.
  SLACK_THEO_USER_ID: z.string().optional(),
  // Approved channel for test routing (C…). Bot must be invited to this channel.
  // /invite @<bot-name> inside the channel before routing will work.
  SLACK_ROUTE_TEST_CHANNEL_ID: z.string().optional(),

  // Dashboard operator session secret — signs HttpOnly cookies for triage actors.
  // Set a long random string in production: openssl rand -hex 32
  DASHBOARD_OPERATOR_SESSION_SECRET: z.string().optional(),

  // Cron endpoint protection secret. Set in Vercel env and pass as Authorization: Bearer <secret>.
  // Generate with: openssl rand -hex 32
  CRON_SECRET: z.string().optional(),

  // Future domain-wide delegation — not used in V1
  GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),
  GOOGLE_WORKSPACE_ADMIN_EMAIL: z.string().optional(),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Missing or invalid environment variables:\n${missing}\n\nCopy .env.local.example to .env.local and fill in the values.`);
  }
  return result.data;
}

// Lazy-validated env — throws with a clear message on first access if vars are missing.
// Using a Proxy so the shape matches z.infer<typeof envSchema> for TypeScript,
// but validation only fires during request handling (not at Next.js build-analysis time).
let _validated: z.infer<typeof envSchema> | undefined;

function getValidated(): z.infer<typeof envSchema> {
  if (!_validated) _validated = parseEnv();
  return _validated;
}

export const env: z.infer<typeof envSchema> = new Proxy({} as z.infer<typeof envSchema>, {
  get(_, prop: string | symbol) {
    return getValidated()[prop as keyof z.infer<typeof envSchema>];
  },
});

// Derived helpers to avoid repeated string splitting.
export function getInternalDomains(): string[] {
  return env.INTERNAL_EMAIL_DOMAINS.split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function getAutomatedAlertDenylist(): string[] {
  return env.AUTOMATED_ALERT_DENYLIST.split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}
