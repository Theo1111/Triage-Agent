-- 011_health_alert_state.sql
-- Persistent state for critical-health alerting: dedup + cooldown + recovery.
-- One row per alert key holds whether it is currently firing and when it last
-- fired, so the alerter never floods the destination on repeated health polls.
--
-- Additive, idempotent, non-destructive.

CREATE TABLE IF NOT EXISTS health_alert_state (
  alert_key      text PRIMARY KEY,
  status         text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'firing')),
  level          text,
  last_fired_at  timestamptz,
  last_recovered_at timestamptz,
  last_value     text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
