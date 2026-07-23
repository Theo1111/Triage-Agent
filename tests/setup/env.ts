// Provides harmless dummy values for the required env vars so modules that read
// the validated `env` proxy (routes, services) can be imported in tests without
// real credentials. Never put real secrets here. Existing env values win.
const defaults: Record<string, string> = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  APP_BASE_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  GOOGLE_REDIRECT_URI: "http://localhost:3000/api/auth/google/callback",
  GOOGLE_PUBSUB_TOPIC: "projects/test/topics/test",
  GOOGLE_PUBSUB_SUBSCRIPTION: "projects/test/subscriptions/test",
  ATTACHMENT_STORAGE_BUCKET: "test-bucket",
  OPENAI_API_KEY: "sk-test-key",
};

for (const [k, v] of Object.entries(defaults)) {
  if (!process.env[k]) process.env[k] = v;
}
