export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export const GMAIL_LABEL_INBOX = "INBOX";

// Gmail watches expire after ~7 days. We renew before that threshold.
export const GMAIL_WATCH_EXPIRY_THRESHOLD_HOURS = 24;
