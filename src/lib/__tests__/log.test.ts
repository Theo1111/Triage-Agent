import { describe, test, expect } from "vitest";
import { sanitizeFields, isSensitiveKey, summarizeError } from "@/src/lib/log";

describe("sanitizeFields", () => {
  test("redacts secret-bearing keys", () => {
    const out = sanitizeFields({
      token: "xoxb-abc",
      access_token: "secret",
      apiKey: "k",
      password: "p",
      authorization: "Bearer x",
      refreshToken: "r",
      inboundEmailId: "id-1",
    } as never);
    expect(out.token).toBe("[redacted]");
    expect(out.access_token).toBe("[redacted]");
    expect(out.apiKey).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect(out.refreshToken).toBe("[redacted]");
    // Safe identifier passes through.
    expect(out.inboundEmailId).toBe("id-1");
  });

  test("drops null/undefined and non-scalar values", () => {
    const out = sanitizeFields({ a: null, b: undefined, c: { nested: 1 } as never, d: 5 });
    expect("a" in out).toBe(false);
    expect("b" in out).toBe(false);
    expect("c" in out).toBe(false);
    expect(out.d).toBe(5);
  });

  test("caps long strings so a stray body cannot flood logs", () => {
    const long = "x".repeat(1000);
    const out = sanitizeFields({ note: long });
    expect((out.note as string).length).toBeLessThanOrEqual(301);
    expect((out.note as string).endsWith("…")).toBe(true);
  });

  test("body-like keys are redacted", () => {
    expect(isSensitiveKey("body")).toBe(true);
    expect(isSensitiveKey("raw_response")).toBe(true);
    expect(isSensitiveKey("inbox")).toBe(false);
  });
});

describe("summarizeError", () => {
  test("returns message only, capped", () => {
    expect(summarizeError(new Error("boom"))).toBe("boom");
    expect(summarizeError("plain")).toBe("plain");
    expect(summarizeError(new Error("y".repeat(500))).length).toBeLessThanOrEqual(300);
  });
});
