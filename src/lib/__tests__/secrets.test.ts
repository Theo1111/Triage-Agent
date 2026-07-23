import { describe, test, expect } from "vitest";
import { constantTimeEqual, bearerToken, verifyBearerSecret } from "@/src/lib/secrets";

describe("constantTimeEqual", () => {
  test("true for equal, false for different", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
    expect(constantTimeEqual("short", "a-much-longer-value")).toBe(false);
  });
});

describe("bearerToken", () => {
  test("extracts token after Bearer prefix", () => {
    expect(bearerToken("Bearer xyz")).toBe("xyz");
    expect(bearerToken("xyz")).toBe("");
    expect(bearerToken(null)).toBe("");
  });
});

describe("verifyBearerSecret", () => {
  test("valid token passes", () => {
    const r = verifyBearerSecret("Bearer s3cr3t", "s3cr3t", { name: "CRON_SECRET", isProduction: true });
    expect(r).toEqual({ ok: true, status: 200 });
  });

  test("bad token → 401", () => {
    const r = verifyBearerSecret("Bearer nope", "s3cr3t", { name: "CRON_SECRET", isProduction: true });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  test("missing token → 401", () => {
    const r = verifyBearerSecret(null, "s3cr3t", { name: "CRON_SECRET", isProduction: true });
    expect(r.status).toBe(401);
  });

  test("unset secret in production → 500 config error (fail closed)", () => {
    const r = verifyBearerSecret("Bearer anything", undefined, { name: "CRON_SECRET", isProduction: true });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
    expect(r.error).toMatch(/not configured/i);
  });

  test("unset secret in dev → allowed with warning", () => {
    const r = verifyBearerSecret(null, undefined, { name: "CRON_SECRET", isProduction: false });
    expect(r.ok).toBe(true);
    expect(r.error).toMatch(/dev only/i);
  });
});
