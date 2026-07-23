// Sanitizes correction text into an anonymized fixture candidate: strips emails,
// phone numbers, unit/apartment numbers, long digit runs (account/card-like),
// URLs, and greeting names, while preserving the operational pattern so the
// example stays useful for evaluation. This is a first pass — the workflow still
// REQUIRES manual review before any candidate is committed to the corpus.

export interface SanitizeResult {
  text: string;
  redactions: Record<string, number>;
}

const RULES: Array<{ label: string; re: RegExp; replace: string }> = [
  { label: "email", re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, replace: "[email]" },
  { label: "url", re: /https?:\/\/[^\s]+/gi, replace: "[url]" },
  // Unit / apartment / suite designators (# is not a word char, so it can't sit
  // behind \b — handle it as its own alternative).
  { label: "unit", re: /(?:\b(?:unit|apt\.?|apartment|suite|ste\.?)|#)\s*[a-z]?-?\d{1,5}[a-z]?\b/gi, replace: "[unit]" },
  // Street address (number + street words).
  { label: "address", re: /\b\d{1,6}\s+[A-Z][a-zA-Z]+(\s+[A-Z][a-zA-Z]+)*\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Lane|Ln|Court|Ct|Way)\b\.?/g, replace: "[address]" },
  // Long standalone digit runs (account/card/PIN-like), 5+ digits. Runs BEFORE
  // phone so a pure long number is labeled [number] rather than [phone].
  { label: "number", re: /\b\d{5,}\b/g, replace: "[number]" },
  // Phone: +1 (555) 123-4567, 555-123-4567
  { label: "phone", re: /(\+?\d[\d\s().-]{7,}\d)/g, replace: "[phone]" },
  // Greeting names: "Hi John," / "Dear Ms. Smith," / "Hello John Doe,"
  { label: "name", re: /\b(Hi|Hello|Dear|Hey)\s+([A-Z][a-zA-Z]+(\.?\s+[A-Z][a-zA-Z]+){0,2})\s*,/g, replace: "$1 [name]," },
];

export function sanitizeText(input: string): SanitizeResult {
  let text = input;
  const redactions: Record<string, number> = {};
  for (const rule of RULES) {
    text = text.replace(rule.re, (...args) => {
      redactions[rule.label] = (redactions[rule.label] ?? 0) + 1;
      // Support the greeting rule which uses capture groups.
      if (rule.replace.includes("$1")) {
        const g1 = args[1];
        return rule.replace.replace("$1", g1);
      }
      return rule.replace;
    });
  }
  return { text, redactions };
}
