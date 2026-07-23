import { describe, test, expect } from "vitest";
import { sanitizeText } from "@/src/lib/sanitizeFixture";

describe("sanitizeText", () => {
  test("strips emails", () => {
    const { text } = sanitizeText("Contact me at jane.doe@example.com please");
    expect(text).not.toMatch(/@example\.com/);
    expect(text).toContain("[email]");
  });

  test("strips phone numbers", () => {
    const { text } = sanitizeText("Call +1 (555) 123-4567 or 555-987-6543");
    expect(text).not.toMatch(/555/);
    expect(text).toContain("[phone]");
  });

  test("strips unit/apartment numbers", () => {
    const { text } = sanitizeText("Resident in Unit 1208 and Apt 4B and #301");
    expect(text).not.toMatch(/1208|4B|301/);
    expect(text).toContain("[unit]");
  });

  test("strips long digit runs (account/card-like)", () => {
    const { text } = sanitizeText("Account 4485992211 needs updating");
    expect(text).not.toMatch(/4485992211/);
    expect(text).toContain("[number]");
  });

  test("strips street addresses", () => {
    const { text } = sanitizeText("They live at 123 Oxford Street North");
    expect(text).toContain("[address]");
    expect(text).not.toMatch(/123 Oxford/);
  });

  test("redacts greeting names but preserves the greeting word", () => {
    const { text } = sanitizeText("Hi John, the door is broken");
    expect(text).toContain("Hi [name],");
    expect(text).not.toMatch(/John/);
  });

  test("preserves the operational pattern", () => {
    const { text } = sanitizeText("Hi Sarah, my fob at Unit 502 stopped working, call me at 555-111-2222");
    expect(text).toMatch(/fob/);
    expect(text).toMatch(/stopped working/);
    expect(text).toContain("[unit]");
    expect(text).toContain("[phone]");
    expect(text).toContain("[name]");
  });

  test("reports redaction counts", () => {
    const { redactions } = sanitizeText("a@b.com and c@d.com");
    expect(redactions.email).toBe(2);
  });
});
