// Configurable classification constants.
// Set via environment variables to avoid hardcoding operational details.

export const TRIAGE_MODEL =
  process.env.OPENAI_TRIAGE_MODEL ?? "gpt-4o";

export const TRIAGE_PROMPT_VERSION = "v2.0";

// Maximum characters of email body passed to the model.
export const BODY_MAX_CHARS = 12_000;

// Key team members — first-name mentions are flagged during classification.
export const KEY_TEAM_MEMBERS: string[] = (
  process.env.KEY_TEAM_MEMBERS ??
  "Mathew,Arjun,Tanner,Carter,Karen,Emma,Georgia"
)
  .split(",")
  .map((n) => n.trim())
  .filter(Boolean);

// Engineering keywords that signal an engineering escalation.
export const ENGINEERING_KEYWORDS: string[] = (
  process.env.ENGINEERING_KEYWORDS ??
  "engineering,engineer,technical,bug,API,outage,infrastructure,Drake,hardware,firmware,access system,fob,credential,reader,access control,ICT,intercom system,not working,not functioning,panel down,relay,controller,permissions not applying,integration"
)
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

// Category tags that indicate sensitive content requiring private routing.
export const SENSITIVE_CATEGORY_TAGS = new Set([
  "hr",
  "legal",
  "employment",
  "payroll",
  "compensation",
  "personal_finance",
  "medical_or_personal",
  "personnel",
  "private_contract",
  "confidential_account",
  "security_credentials",
]);
