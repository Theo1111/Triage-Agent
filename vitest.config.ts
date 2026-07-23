import { defineConfig } from "vitest/config";
import { resolve } from "path";

// Unit + integration tests run in Node. No test may hit live Gmail, Slack,
// OpenAI, Supabase, Vercel, or Paperclip — external services are mocked at
// their service/repository boundaries (see tests/ and src/**/__tests__).
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "tests/**/*.test.ts",
      "app/**/*.test.ts",
    ],
    // Dummy env for modules that read the validated env proxy (no real creds).
    setupFiles: ["tests/setup/env.ts"],
    // Fork pool terminates workers cleanly even if a transitive import leaves an
    // open handle (e.g. a lazily-created pg pool), so the run never hangs on exit.
    pool: "forks",
    // Keep tests hermetic — no implicit globals; import from "vitest".
    globals: false,
    // Clear call history between tests, but do NOT restore implementations —
    // factory mocks (vi.mock) set their behavior once and must keep it.
    clearMocks: true,
  },
  resolve: {
    // Mirror tsconfig "@/*" -> "./*".
    alias: { "@": resolve(__dirname, ".") },
  },
});
