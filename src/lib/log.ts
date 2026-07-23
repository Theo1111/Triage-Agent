// Structured logging with a fixed set of safe identifier fields. Emits one JSON
// line per event so ingestion, classification, routing, Slack, dashboard, cron,
// and Paperclip all log in a consistent, queryable shape.
//
// NEVER pass tokens, passwords, raw email bodies, full attachment contents, or
// raw model responses. As defense-in-depth, keys that look secret-bearing are
// redacted, and only scalar values are emitted.

export type LogLevel = "debug" | "info" | "warn" | "error";

// The blessed safe-identifier fields (all optional). Extra scalar fields are
// allowed but pass through the same redaction.
export interface LogFields {
  runId?: string | null;
  paperclipRunId?: string | null;
  inboundEmailId?: string | null;
  gmailThreadId?: string | null;
  triageItemId?: string | null;
  classificationId?: string | null;
  inbox?: string | null;
  promptVersion?: string | null;
  model?: string | null;
  stage?: string | null;
  outcome?: string | null;
  durationMs?: number | null;
  retryCount?: number | null;
  [key: string]: string | number | boolean | null | undefined;
}

const REDACT_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /authorization/i,
  /api[_-]?key/i,
  /refresh/i,
  /access[_-]?token/i,
  /cookie/i,
  /credential/i,
  /\bbody\b/i,
  /raw_?response/i,
];

const REDACTED = "[redacted]";

export function isSensitiveKey(key: string): boolean {
  return REDACT_PATTERNS.some(p => p.test(key));
}

// Reduce arbitrary fields to safe, emittable scalars.
export function sanitizeFields(fields: LogFields): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (isSensitiveKey(k)) {
      out[k] = REDACTED;
      continue;
    }
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      // Cap string length so a stray body/blob can never flood logs.
      out[k] = typeof v === "string" && v.length > 300 ? `${v.slice(0, 300)}…` : v;
    }
    // Non-scalars are intentionally dropped.
  }
  return out;
}

// Extract a safe, message-only error summary (no data-bearing stack).
export function summarizeError(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 300);
  return String(err).slice(0, 300);
}

function emit(level: LogLevel, event: string, fields: LogFields = {}) {
  const record = {
    level,
    event,
    ts: new Date().toISOString(),
    ...sanitizeFields(fields),
  };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};
