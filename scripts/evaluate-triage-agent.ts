/* eslint-disable @typescript-eslint/no-explicit-any */
// Deterministic evaluation runner for the triage agent.
//
//   npm run test:evaluation              # offline (default) — CI safe
//   npm run test:evaluation -- --offline
//   npm run test:evaluation -- --live    # calls the model; needs OPENAI_API_KEY
//   npm run test:evaluation -- --fixture=unit-app-login
//   npm run test:evaluation -- --category=access
//
// Offline: validates the corpus + exercises the deterministic routing/sensitivity
// guards (applyRoutingOverrides) and the scoring harness. No model/API calls.
// Live: runs the configured model over the corpus, prints expected-vs-actual,
// computes accuracy metrics, records model + prompt version, and stores sanitized
// results. Never ingests fixtures into production tables, routes to Slack, or
// creates triage cases. Both modes fail (exit 1) when safety thresholds are missed.

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { allFixtures, fixturesBySuite, validateFixture, findDuplicateIds } from "../tests/evaluation/fixtures";
import {
  scoreFixture,
  scoreFixtureOffline,
  projectOutput,
  computeMetrics,
  checkThresholds,
  type EvalMetrics,
} from "../src/evaluation/scoring";
import type { EvalFixture, ScoredResult } from "../src/evaluation/types";

interface Args {
  mode: "offline" | "live";
  fixture?: string;
  category?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: "offline" };
  for (const a of argv) {
    if (a === "--offline") args.mode = "offline";
    else if (a === "--live") args.mode = "live";
    else if (a.startsWith("--fixture=")) args.fixture = a.slice("--fixture=".length);
    else if (a.startsWith("--category=")) args.category = a.slice("--category=".length);
  }
  return args;
}

function selectFixtures(args: Args): EvalFixture[] {
  let list = allFixtures;
  if (args.fixture) list = list.filter(f => f.id === args.fixture);
  if (args.category) {
    const c = args.category.toLowerCase();
    if (c in fixturesBySuite) {
      list = (fixturesBySuite as any)[c];
    } else {
      list = list.filter(
        f =>
          f.suite.includes(c) ||
          f.id.toLowerCase().includes(c) ||
          [f.expected.primaryCategory].flat().some(v => String(v).includes(c))
      );
    }
  }
  return list;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function printReport(metrics: EvalMetrics, mode: string, model?: string, promptVersion?: string) {
  console.log(`\n=== Triage Evaluation (${mode}) ===`);
  if (model) console.log(`model=${model} promptVersion=${promptVersion}`);
  console.log(`fixtures: ${metrics.total}`);
  console.log(`overall accuracy:            ${pct(metrics.overallAccuracy)}`);
  console.log(`actionable  P/R/F1:          ${pct(metrics.actionable.precision)} / ${pct(metrics.actionable.recall)} / ${pct(metrics.actionable.f1)}`);
  console.log(`urgency(urgent) P/R:         ${pct(metrics.urgencyUrgent.precision)} / ${pct(metrics.urgencyUrgent.recall)}`);
  console.log(`sensitivity(sens) P/R:       ${pct(metrics.sensitivitySensitive.precision)} / ${pct(metrics.sensitivitySensitive.recall)}`);
  console.log(`safety-critical recall:      ${pct(metrics.safetyCriticalRecall)}`);
  console.log(`category accuracy:           ${pct(metrics.categoryAccuracy)}`);
  console.log(`owner/team accuracy:         ${pct(metrics.ownerAccuracy)}`);
  console.log(`route accuracy:              ${pct(metrics.routeAccuracy)}`);
  console.log(`slack-eligibility accuracy:  ${pct(metrics.slackEligibilityAccuracy)}`);
  console.log(`manual-review accuracy:      ${pct(metrics.manualReviewAccuracy)}`);
  console.log(`false-positive rate:         ${pct(metrics.falsePositiveRate)}`);
  console.log(`false-negative rate:         ${pct(metrics.falseNegativeRate)}`);
  console.log(`\nby suite:`);
  for (const [s, v] of Object.entries(metrics.bySuite)) {
    console.log(`  ${s.padEnd(16)} ${v.passed}/${v.total} (${pct(v.accuracy)})`);
  }
  console.log(`\nby category:`);
  for (const [c, v] of Object.entries(metrics.byCategory)) {
    console.log(`  ${c.padEnd(26)} ${v.correct}/${v.total} (${pct(v.accuracy)})`);
  }
  if (metrics.failedFixtureIds.length) {
    console.log(`\nfailed fixtures: ${metrics.failedFixtureIds.join(", ")}`);
  }
  if (metrics.safetyFailedFixtureIds.length) {
    console.log(`SAFETY failures: ${metrics.safetyFailedFixtureIds.join(", ")}`);
  }
}

async function runOffline(fixtures: EvalFixture[]): Promise<number> {
  // 1. Corpus integrity.
  const dups = findDuplicateIds(allFixtures);
  if (dups.length) {
    console.error(`Duplicate fixture ids: ${dups.join(", ")}`);
    return 1;
  }
  const problems = fixtures.flatMap(validateFixture);
  if (problems.length) {
    console.error(`Corpus validation failed:\n  ${problems.join("\n  ")}`);
    return 1;
  }

  // 2. Deterministic-guard self-consistency: run each fixture's ideal output
  //    through applyRoutingOverrides and confirm it agrees with expectations.
  const results: ScoredResult[] = fixtures.map(scoreFixtureOffline);
  const metrics = computeMetrics(fixtures, results);
  printReport(metrics, "offline");

  const inconsistent = results.filter(r => !r.passed);
  if (inconsistent.length) {
    console.error(
      `\nOffline self-consistency FAILED — these fixtures contradict the deterministic guards:`
    );
    for (const r of inconsistent) {
      const bad = r.fields.filter(f => !f.correct).map(f => `${f.field}(exp ${f.expected} got ${f.actual})`);
      console.error(`  ${r.fixtureId}: ${bad.join(", ")}`);
    }
    return 1;
  }
  console.log(`\n✓ offline: ${fixtures.length} fixtures valid and self-consistent with routing guards`);
  return 0;
}

async function runLive(fixtures: EvalFixture[]): Promise<number> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Live evaluation requires OPENAI_API_KEY. Aborting (no key configured).");
    return 1;
  }
  // Dynamic import so offline never loads the model client.
  const { EmailTriageAgent } = await import("../src/agents/emailTriageAgent");

  const results: ScoredResult[] = [];
  const detail: any[] = [];
  let model = "";
  let promptVersion = "";

  for (const fx of fixtures) {
    const input = {
      inbound_email_id: fx.id,
      source_inbox_email: fx.inbox,
      sender_email: `${fx.senderType}@example.test`,
      sender_name: null,
      recipient_emails: [fx.inbox],
      cc_emails: null,
      subject: fx.subject,
      snippet: fx.body.slice(0, 160),
      body_text: fx.body,
      body_text_truncated: false,
      label_ids: null,
      received_at: null,
      has_attachments: false,
      attachment_count: 0,
      attachments: [],
      is_thread_reply: fx.threadContext?.isThreadReply ?? false,
      thread_prior_message_count: fx.threadContext?.priorMessageCount ?? 0,
      existing_triage_item_id: null,
      existing_triage_status: fx.threadContext?.existingStatus ?? null,
    };
    try {
      const { output } = await EmailTriageAgent.classify(input as any);
      model = (EmailTriageAgent as any).model ?? model;
      promptVersion = (EmailTriageAgent as any).promptVersion ?? promptVersion;
      const actual = projectOutput(output);
      const scored = scoreFixture(fx, actual);
      results.push(scored);
      detail.push({ fixtureId: fx.id, suite: fx.suite, expected: fx.expected, actual, passed: scored.passed });
      const flag = scored.passed ? "✓" : scored.safetyPassed ? "~" : "✗SAFETY";
      console.log(`${flag} ${fx.id}`);
      if (!scored.passed) {
        for (const f of scored.fields.filter(f => !f.correct)) {
          console.log(`     ${f.field}: expected ${f.expected} got ${f.actual}${f.safetyCritical ? "  [SAFETY]" : ""}`);
        }
      }
    } catch (err) {
      console.error(`✗ ${fx.id}: classify threw — ${(err as Error).message}`);
      // Count a hard failure as an all-wrong result so metrics reflect it.
      results.push({
        fixtureId: fx.id, suite: fx.suite, passed: false, safetyPassed: (fx.safetyCritical ?? []).length === 0,
        fields: [], actual: {} as any,
      });
    }
  }

  const metrics = computeMetrics(fixtures, results);
  printReport(metrics, "live", model, promptVersion);

  // Store sanitized results (fixtures are already synthetic; no customer data).
  const outDir = resolve(process.cwd(), "eval-results");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = resolve(outDir, `eval-${stamp}.json`);
  writeFileSync(outFile, JSON.stringify({ model, promptVersion, generatedAt: new Date().toISOString(), metrics, detail }, null, 2));
  console.log(`\nsanitized results written to ${outFile}`);

  const check = checkThresholds(metrics);
  if (!check.passed) {
    console.error(`\nEVALUATION FAILED — thresholds missed:\n  ${check.failures.join("\n  ")}`);
    return 1;
  }
  console.log(`\n✓ live: thresholds met`);
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = selectFixtures(args);
  if (fixtures.length === 0) {
    console.error("No fixtures matched the selection.");
    process.exit(1);
  }
  const code = args.mode === "live" ? await runLive(fixtures) : await runOffline(fixtures);
  process.exit(code);
}

main().catch(err => {
  console.error("Evaluation runner crashed:", err);
  process.exit(1);
});
