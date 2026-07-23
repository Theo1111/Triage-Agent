/* eslint-disable @typescript-eslint/no-explicit-any */
// Exports admin-APPROVED corrections as sanitized fixture CANDIDATES. Candidates
// are written to eval-candidates/ (gitignored) — they are NEVER auto-added to the
// permanent corpus. A human must review each candidate (identity fully stripped,
// operational pattern preserved) before copying it into tests/evaluation/fixtures.
//
//   npm run test:evaluation is unaffected. Run manually:
//   tsx scripts/export-correction-fixtures.ts

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import * as correctionsRepo from "../src/repositories/humanCorrectionsRepository";
import { sanitizeText } from "../src/lib/sanitizeFixture";

async function main() {
  const approved = await correctionsRepo.listByReviewStatus("approved_for_eval", 1000);
  if (approved.length === 0) {
    console.log("No corrections marked 'approved_for_eval'. Nothing to export.");
    return;
  }

  const candidates = approved.map((c, i) => {
    // The correction row does not store raw email bodies; sanitize the reason +
    // any free-text so no identity leaks into a candidate.
    const reason = sanitizeText(c.reason ?? "");
    const summary = sanitizeText((c.summary as string) ?? "");
    return {
      candidateId: `candidate-${i + 1}`,
      // Operational pattern only — reviewer supplies a synthetic subject/body.
      note: "Manual review REQUIRED before adding to the corpus. Replace placeholders and write synthetic subject/body.",
      expected: {
        relevance: c.relevance ?? undefined,
        urgency: c.urgency_level ?? undefined,
        sensitivity: c.sensitivity_level ?? undefined,
        primaryCategory: c.primary_category ?? undefined,
        recommendedOwner: c.recommended_owner ?? undefined,
        routeType: c.route_type ?? undefined,
        slackEligible: c.slack_eligible ?? undefined,
        manualReviewRequired: c.manual_review_required ?? undefined,
      },
      reasonSanitized: reason.text,
      summarySanitized: summary.text,
      promptVersion: c.prompt_version,
      modelName: c.model_name,
    };
  });

  const outDir = resolve(process.cwd(), "eval-candidates");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `candidates-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), count: candidates.length, candidates }, null, 2));

  console.log(`Wrote ${candidates.length} sanitized fixture candidate(s) to ${outFile}`);
  console.log("These are NOT in the corpus. Review each, strip any remaining identity, then add manually.");
}

main().catch(err => {
  console.error("Export failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
