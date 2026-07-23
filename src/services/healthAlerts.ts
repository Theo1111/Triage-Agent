// Critical-health alerting with dedup, cooldown, and recovery. Disabled unless
// explicitly configured (SLACK_ALERT_CHANNEL_ID + SLACK_BOT_TOKEN). The decision
// logic is pure and unit-tested; sending + persistence are thin wrappers so we
// never flood the destination when the health endpoint is polled frequently.

import { query, queryOne } from "@/src/lib/db";
import { getDashboardHealth, type HealthCheck } from "@/src/services/dashboardHealth";
import { postMessage } from "@/src/lib/slack/slackWebApi";
import { logEvent } from "@/src/services/agentAuditLog";
import { logger } from "@/src/lib/log";

export interface AlertStateRecord {
  alert_key: string;
  status: "ok" | "firing";
  last_fired_at: string | null;
}

export interface FireAction {
  key: string;
  label: string;
  level: string;
  detail: string;
  action?: string;
  kind: "fire" | "reminder";
}
export interface RecoverAction {
  key: string;
  label: string;
}

export interface AlertDecision {
  toFire: FireAction[];
  toRecover: RecoverAction[];
  nextState: Record<string, { status: "ok" | "firing"; lastFiredAt: number | null }>;
}

// Pure decision: which alerts to fire/recover given current health checks and
// the prior persisted state. A check alerts when its level is not "ok". A firing
// alert re-fires (reminder) only after the cooldown; otherwise it is deduped.
export function decideAlertActions(
  checks: Array<Pick<HealthCheck, "key" | "label" | "level" | "detail" | "action">>,
  prior: Record<string, { status: "ok" | "firing"; lastFiredAt: number | null }>,
  now: number,
  cooldownMs: number
): AlertDecision {
  const toFire: FireAction[] = [];
  const toRecover: RecoverAction[] = [];
  const nextState: AlertDecision["nextState"] = { ...prior };

  for (const c of checks) {
    const priorStatus = prior[c.key]?.status ?? "ok";
    const lastFiredAt = prior[c.key]?.lastFiredAt ?? null;
    const alerting = c.level !== "ok";

    if (alerting) {
      if (priorStatus === "firing") {
        // Dedup: only re-fire (reminder) once the cooldown has elapsed.
        if (lastFiredAt != null && now - lastFiredAt >= cooldownMs) {
          toFire.push({ key: c.key, label: c.label, level: c.level, detail: c.detail, action: c.action, kind: "reminder" });
          nextState[c.key] = { status: "firing", lastFiredAt: now };
        } else {
          nextState[c.key] = { status: "firing", lastFiredAt };
        }
      } else {
        toFire.push({ key: c.key, label: c.label, level: c.level, detail: c.detail, action: c.action, kind: "fire" });
        nextState[c.key] = { status: "firing", lastFiredAt: now };
      }
    } else {
      if (priorStatus === "firing") {
        toRecover.push({ key: c.key, label: c.label });
      }
      nextState[c.key] = { status: "ok", lastFiredAt: null };
    }
  }

  return { toFire, toRecover, nextState };
}

// ── Persistence (self-heals the table) ───────────────────────────────────────

let _ensured: Promise<void> | null = null;
async function ensureTable(): Promise<void> {
  if (!_ensured) {
    _ensured = query(`
      CREATE TABLE IF NOT EXISTS health_alert_state (
        alert_key text PRIMARY KEY,
        status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','firing')),
        level text,
        last_fired_at timestamptz,
        last_recovered_at timestamptz,
        last_value text,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `).then(() => undefined).catch(err => { _ensured = null; throw err; });
  }
  return _ensured;
}

async function loadPriorState(): Promise<Record<string, { status: "ok" | "firing"; lastFiredAt: number | null }>> {
  await ensureTable();
  const rows = await query<AlertStateRecord>(`SELECT alert_key, status, last_fired_at FROM health_alert_state`);
  const out: Record<string, { status: "ok" | "firing"; lastFiredAt: number | null }> = {};
  for (const r of rows) {
    out[r.alert_key] = {
      status: r.status,
      lastFiredAt: r.last_fired_at ? new Date(r.last_fired_at).getTime() : null,
    };
  }
  return out;
}

async function persistFire(key: string, level: string, firedAt: number): Promise<void> {
  await queryOne(
    `INSERT INTO health_alert_state (alert_key, status, level, last_fired_at, updated_at)
     VALUES ($1, 'firing', $2, to_timestamp($3 / 1000.0), now())
     ON CONFLICT (alert_key) DO UPDATE SET status='firing', level=$2, last_fired_at=to_timestamp($3 / 1000.0), updated_at=now()`,
    [key, level, firedAt]
  );
}
async function persistRecover(key: string): Promise<void> {
  await queryOne(
    `UPDATE health_alert_state SET status='ok', last_recovered_at=now(), updated_at=now() WHERE alert_key=$1`,
    [key]
  );
}

export interface AlertConfig {
  channelId?: string;
  botToken?: string;
  cooldownMs: number;
}

function alertConfig(): AlertConfig {
  const minutes = Number(process.env.HEALTH_ALERT_COOLDOWN_MINUTES ?? "60");
  return {
    channelId: process.env.SLACK_ALERT_CHANNEL_ID,
    botToken: process.env.SLACK_BOT_TOKEN,
    cooldownMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60_000,
  };
}

export interface RunAlertsResult {
  enabled: boolean;
  fired: number;
  recovered: number;
  suppressed: number;
}

// Evaluate health and fire/recover alerts. No-op (enabled:false) unless a
// destination channel + bot token are configured. Never includes email content.
export async function runHealthAlerts(now = Date.now()): Promise<RunAlertsResult> {
  const cfg = alertConfig();
  const health = await getDashboardHealth();
  const prior = await loadPriorState();
  const decision = decideAlertActions(health.checks, prior, now, cfg.cooldownMs);

  const enabled = !!(cfg.channelId && cfg.botToken);
  const suppressed =
    health.checks.filter(c => c.level !== "ok").length - decision.toFire.length;

  // Always persist state + audit so dedup works even before a destination is set.
  for (const f of decision.toFire) {
    await persistFire(f.key, f.level, now);
    await logEvent({
      eventType: "health_alert_fired",
      actorType: "system",
      action: `Health alert ${f.kind}: ${f.label} (${f.level})`,
      reason: f.detail,
      metadata: { key: f.key, level: f.level },
    });
    if (enabled) {
      const text = `🚨 *${f.label}* — ${f.detail}${f.action ? `\n→ ${f.action}` : ""}`;
      await postMessage(cfg.botToken!, cfg.channelId!, text, []).catch(err =>
        logger.error("health_alert.send_failed", { key: f.key, error: String(err) })
      );
    }
  }
  for (const r of decision.toRecover) {
    await persistRecover(r.key);
    await logEvent({
      eventType: "health_alert_recovered",
      actorType: "system",
      action: `Health recovered: ${r.label}`,
      metadata: { key: r.key },
    });
    if (enabled) {
      await postMessage(cfg.botToken!, cfg.channelId!, `✅ *Recovered:* ${r.label}`, []).catch(() => {});
    }
  }

  logger.info("health_alerts.run", {
    outcome: "ok",
    fired: decision.toFire.length,
    recovered: decision.toRecover.length,
  });
  return { enabled, fired: decision.toFire.length, recovered: decision.toRecover.length, suppressed };
}
