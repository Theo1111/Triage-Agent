# Paperclip ⇄ Triage Agent contract

Two endpoints connect Paperclip to the Triage Agent. Both authenticate with a
shared bearer secret and never return sensitive data (email bodies, senders,
tokens, or raw model output). Contract tests live in
`tests/integration/paperclipContract.test.ts`.

## Auth (both endpoints)

```
Authorization: Bearer <PAPERCLIP_HEARTBEAT_SECRET>
```

Fail-closed (`src/lib/secrets.ts`):

| Condition                          | Response |
| ---------------------------------- | -------- |
| Valid token                        | proceed |
| Missing / wrong token              | `401 { "error": "Unauthorized" }` |
| Secret unset **in production**     | `500 { "error": "PAPERCLIP_HEARTBEAT_SECRET is not configured…" }` |
| Secret unset in dev                | allowed with a warning |

Comparison is constant-time (SHA-256 + `timingSafeEqual`).

## POST `/api/paperclip/heartbeat`

Drains the classification backlog. Idempotent per email (suppressed/linked
replies are marked `classification_ready` so they are not reprocessed).

Request body (all optional):

```jsonc
{ "runId": "string",   // echoed back as paperclipRunId
  "limit": 25 }        // 1–100, invalid → default 25
```

Response `200`:

```jsonc
{
  "ok": true,
  "paperclipRunId": "string | null",
  "found": 0,
  "processed": 0,
  "failed": 0,
  "results": [
    { "inboundEmailId": "uuid",
      "outcome": "classified | pipeline_error | skipped | threw",
      "triageItemId": "uuid | null" }
  ]
}
```

`500 { "ok": false, "error": "Heartbeat invocation failed" }` on unhandled error.
No email content is ever included.

## GET `/api/paperclip/analytics`

Safe aggregate metrics over a bounded window.

Query params: `days` (1–90, default 7), `runId` (echoed back).

Response `200`:

```jsonc
{
  "ok": true,
  "paperclipRunId": "string | null",
  "analytics": {
    "windowDays": 7,
    "generatedAt": "ISO-8601",
    "emails": {
      "classified": 0,
      "awaitingClassification": 0,
      "classificationFailures": 0,
      "classificationSuccessRate": 1
    },
    "triage": {
      "activeTotal": 0,
      "manualReview": 0,
      "teamCounts": { "engineering": 0, "customer_success": 0, "operations": 0, "field_ops": 0, "unassigned": 0 }
    },
    "slack": { "delivered": 0, "failed": 0, "deliverySuccessRate": 1 },
    "quality": {
      "corrections": 0, "correctionRate": 0,
      "falsePositives": 0, "falseNegatives": 0,
      "urgencyCorrections": 0, "sensitivityCorrections": 0
    }
  }
}
```

`500 { "ok": false, "error": "Analytics query failed" }` on error.

## Versioning

Both payloads are additive-only. New fields may be added; existing fields keep
their meaning. Breaking changes require a new path (e.g. `/api/paperclip/v2/...`)
so Paperclip and the Triage Agent can evolve independently. Keep the contract
tests in lockstep with any change here.
