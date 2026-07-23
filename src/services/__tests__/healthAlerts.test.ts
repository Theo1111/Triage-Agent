import { describe, test, expect } from "vitest";
import { decideAlertActions } from "@/src/services/healthAlerts";

const COOLDOWN = 60 * 60_000; // 1h
const check = (key: string, level: string) => ({ key, label: key, level, detail: `${key} detail`, action: "fix it" });

describe("decideAlertActions", () => {
  test("fires a new alert when a check goes critical", () => {
    const d = decideAlertActions([check("gmail_watch", "crit")], {}, 1000, COOLDOWN);
    expect(d.toFire).toHaveLength(1);
    expect(d.toFire[0]).toMatchObject({ key: "gmail_watch", kind: "fire" });
    expect(d.nextState.gmail_watch.status).toBe("firing");
  });

  test("dedupes a still-firing alert within the cooldown", () => {
    const prior = { gmail_watch: { status: "firing" as const, lastFiredAt: 1000 } };
    const d = decideAlertActions([check("gmail_watch", "crit")], prior, 1000 + COOLDOWN / 2, COOLDOWN);
    expect(d.toFire).toHaveLength(0); // deduped
    expect(d.toRecover).toHaveLength(0);
    expect(d.nextState.gmail_watch.status).toBe("firing");
  });

  test("re-fires a reminder after the cooldown elapses", () => {
    const prior = { gmail_watch: { status: "firing" as const, lastFiredAt: 1000 } };
    const d = decideAlertActions([check("gmail_watch", "crit")], prior, 1000 + COOLDOWN + 1, COOLDOWN);
    expect(d.toFire).toHaveLength(1);
    expect(d.toFire[0].kind).toBe("reminder");
    expect(d.nextState.gmail_watch.lastFiredAt).toBe(1000 + COOLDOWN + 1);
  });

  test("sends a recovery when a firing alert returns to ok", () => {
    const prior = { gmail_watch: { status: "firing" as const, lastFiredAt: 1000 } };
    const d = decideAlertActions([check("gmail_watch", "ok")], prior, 5000, COOLDOWN);
    expect(d.toRecover).toEqual([{ key: "gmail_watch", label: "gmail_watch" }]);
    expect(d.toFire).toHaveLength(0);
    expect(d.nextState.gmail_watch.status).toBe("ok");
  });

  test("no action when a check is ok and was never firing", () => {
    const d = decideAlertActions([check("slack_delivery", "ok")], {}, 1000, COOLDOWN);
    expect(d.toFire).toHaveLength(0);
    expect(d.toRecover).toHaveLength(0);
  });

  test("warn-level checks also alert (dedup applies equally)", () => {
    const d1 = decideAlertActions([check("classification_backlog", "warn")], {}, 1000, COOLDOWN);
    expect(d1.toFire).toHaveLength(1);
    const d2 = decideAlertActions([check("classification_backlog", "warn")], d1.nextState, 1500, COOLDOWN);
    expect(d2.toFire).toHaveLength(0); // deduped
  });
});
