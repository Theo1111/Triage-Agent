// Tests for cleanEmailBodyForTriage.
//
// Run with: npx tsx --test src/lib/__tests__/cleanEmailBody.test.ts
// (requires: npm install -D tsx)

import { test, describe } from "vitest";
import assert from "node:assert/strict";
import { cleanEmailBodyForTriage } from "../cleanEmailBody";

describe("cleanEmailBodyForTriage", () => {
  // A — Exclaimer tracking URL lines are removed
  test("A: removes Exclaimer tracking URLs", () => {
    const input = `Hi team,

The fob access reader at Unit 302 is offline.

Please advise.

Mario Cardona
https://us.content.exclaimer.net/content/e4a1234b-abcd-4efg-hi12-jk34lm567nop/img/track/open.gif`;

    const result = cleanEmailBodyForTriage(input);
    assert.ok(!result.includes("exclaimer.net"), "Exclaimer URL should be removed");
    assert.ok(result.includes("fob access reader"), "Body content should be kept");
  });

  // B — Outlook/iPhone signature stripped
  test("B: removes Outlook and iPhone mobile signatures", () => {
    const outlookSig = `Access issue on the 3rd floor — residents can't get in.

Get Outlook for iOS`;

    const iphoneSig = `Urgent: fob reader is down again.

Sent from my iPhone`;

    const r1 = cleanEmailBodyForTriage(outlookSig);
    assert.ok(!r1.includes("Get Outlook"), "Outlook sig should be removed");
    assert.ok(r1.includes("Access issue"), "Body content should be kept");

    const r2 = cleanEmailBodyForTriage(iphoneSig);
    assert.ok(!r2.includes("Sent from my iPhone"), "iPhone sig should be removed");
    assert.ok(r2.includes("fob reader is down"), "Body content should be kept");
  });

  // C — mailto: link markup removed, display text kept
  test("C: removes mailto: link markup, keeps display text", () => {
    const input = `Please contact Mario Cardona at Mario.Cardona@zekelman.com<mailto:Mario.Cardona@zekelman.com> for details.`;

    const result = cleanEmailBodyForTriage(input);
    assert.ok(!result.includes("<mailto:"), "mailto: markup should be removed");
    assert.ok(result.includes("Mario.Cardona@zekelman.com"), "Display email should be kept");
  });

  // D — tel: link markup removed, display text kept
  test("D: removes tel: link markup, keeps display text", () => {
    const input = `c: (602) 853-3329<tel:+16028533329>
o: (480) 941-9851<tel:+14809419851>

The door lock is broken.`;

    const result = cleanEmailBodyForTriage(input);
    assert.ok(!result.includes("<tel:"), "tel: markup should be removed");
    assert.ok(result.includes("The door lock is broken"), "Body content should be kept");
  });

  // E — cid: image placeholders removed
  test("E: removes cid: image placeholders", () => {
    const input = `Hi,

The access reader shows an error.

[cid:image001.jpg@01DA1234.5678ABCD]
<cid:image002.png@01DA1234.5678ABCD>

Thanks`;

    const result = cleanEmailBodyForTriage(input);
    assert.ok(!result.includes("[cid:"), "bracket cid placeholder should be removed");
    assert.ok(!result.includes("<cid:"), "angle-bracket cid placeholder should be removed");
    assert.ok(result.includes("access reader shows an error"), "Body content should be kept");
  });

  // F — short ack + long signature: ack preserved, sig removed
  test("F: keeps short acknowledgement text, removes long signature block", () => {
    const input = `Okay, thank you!

Mario Cardona
Regional Property Manager | Zekelman Industries
c: (602) 853-3329<tel:+16028533329>
o: (480) 941-9851<tel:+14809419851>
Mario.Cardona@zekelman.com<mailto:Mario.Cardona@zekelman.com>
www.zekelman.com
https://us.content.exclaimer.net/content/abc123/img/track/open.gif`;

    const result = cleanEmailBodyForTriage(input);
    assert.ok(result.includes("Okay, thank you"), "Ack text should be kept");
    assert.ok(!result.includes("<tel:"), "tel: markup should be removed");
    assert.ok(!result.includes("<mailto:"), "mailto: markup should be removed");
    assert.ok(!result.includes("exclaimer.net"), "Exclaimer URL should be removed");
  });

  // G — closure phrase + signature: closure preserved, sig removed
  test("G: keeps closure text, removes signature", () => {
    const input = `It's working now, thanks for the quick fix!

Best regards,
Sarah Chen
Property Manager
sarah.chen@example.com
(416) 555-0123`;

    const result = cleanEmailBodyForTriage(input);
    assert.ok(result.includes("working now"), "Closure text should be kept");
    assert.ok(!result.includes("Best regards"), "Sign-off should be removed");
    assert.ok(!result.includes("sarah.chen@example.com"), "Email in sig should be removed");
    assert.ok(!result.includes("(416) 555-0123"), "Phone in sig should be removed");
  });

  // H — urgent issue + signature: full body preserved minus sig
  test("H: keeps urgent issue body, removes trailing signature", () => {
    const input = `Hi,

URGENT: The front door access reader at 123 Main St has been offline since 6am.
All 40 residents are locked out. Building manager is on site but cannot override.
We need immediate assistance.

Regards,
Tom Bradley
Facilities Manager
tom.bradley@example.com
555-867-5309`;

    const result = cleanEmailBodyForTriage(input);
    assert.ok(result.includes("URGENT"), "Urgent message should be kept");
    assert.ok(result.includes("40 residents are locked out"), "Impact description should be kept");
    assert.ok(!result.includes("Regards,"), "Sign-off should be removed");
    assert.ok(!result.includes("tom.bradley@example.com"), "Email in sig should be removed");
    assert.ok(!result.includes("Facilities Manager"), "Title in sig should be removed");
  });
});
