# Production acceptance checklist — Triage Agent

End-to-end acceptance workflow, grouped by what each step requires. Run top to
bottom. Steps are safe to repeat.

## A. No credentials required (CI / local)

- [ ] `npm ci`
- [ ] `npm run typecheck` — passes
- [ ] `npm run lint` — passes
- [ ] `npm test` — unit + integration pass
- [ ] `npm run build` — production build succeeds
- [ ] `npm run test:evaluation -- --offline` — corpus valid + self-consistent with routing guards

## B. Requires database access (staging/prod)

- [ ] Apply migrations `008`–`011` (additive, idempotent, non-destructive).
- [ ] `npm run test:smoke` — DB connectivity, required tables/columns, operator config,
      watch state, backlog, config presence, latest classification + Slack delivery all PASS/expected WARN.

## C. Requires Gmail approval

1. [ ] Connect the approved Gmail inbox (OAuth).
2. [ ] Create or renew the Gmail watch (`/api/gmail/watch` or the daily cron).
3. [ ] Ingest one **approved test email** into the inbox.
4. [ ] Confirm it is classified (dashboard Agent view / `email_classifications`).
5. [ ] Confirm urgency + sensitivity are correct for the test content.
6. [ ] Confirm exactly **one canonical thread case** (no duplicate rows in the active queue).
7. [ ] Confirm it lands in the correct queue/team view.

## D. Requires Slack IDs + bot permissions

8. [ ] Confirm the Slack alert posted (for an eligible urgent, public case).
9. [ ] Assign the case in the dashboard.
10. [ ] Confirm the Slack card updated to show the assignment.
11. [ ] Reply in the **same Gmail thread** as the test email.
12. [ ] Confirm the case timeline shows the new message with **no duplicate case**.
13. [ ] Resolve the case from Slack or the dashboard.
14. [ ] Confirm state is synchronized on the other surface.
15. [ ] Send a new customer issue in the thread and confirm the case reopens appropriately.
16. [ ] Test a manual **Correct classification** in the drawer; confirm the AI result is preserved
       and the effective value shows a "human" source.
17. [ ] Test **Reclassify → preview**; confirm the diff renders and nothing changes until confirmed.
18. [ ] Test **failed Slack replay** (admin) on a case whose delivery failed; confirm an audit event.
19. [ ] Confirm the dashboard **System health** panel reflects real backend state.

## E. Requires Paperclip configuration

20. [ ] `POST /api/paperclip/heartbeat` with the secret returns a safe payload and drains backlog;
        `GET /api/paperclip/analytics` returns safe aggregates. (See `docs/PAPERCLIP_CONTRACT.md`.)

## F. Optional — live model evaluation (manual, needs OPENAI_API_KEY)

- [ ] `npm run test:evaluation -- --live` — real accuracy metrics; fails if safety thresholds are missed.
      Results are written (sanitized) to `eval-results/`. Never run in CI.

## Data-safety guarantees (must remain true)

- No migration deletes inbound emails, classifications, triage cases, attachments,
  operator profiles, Gmail watch history, Slack references, or audit logs.
- Corrections and reclassifications are stored as separate layers; the original
  model result is never overwritten.
- Secrets, tokens, raw email bodies, and raw model output are never logged or returned.
