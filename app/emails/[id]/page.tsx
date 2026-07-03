import { notFound } from "next/navigation";
import Link from "next/link";
import { queryOne } from "@/src/lib/db";
import { formatCategoryLabel } from "@/src/lib/formatCategory";
import type { EmailClassification, TriageItem } from "@/src/types/database";

export const dynamic = "force-dynamic";

interface EmailDetail {
  id: string;
  source_inbox_email: string;
  sender_email: string | null;
  sender_name: string | null;
  recipient_emails: string[] | null;
  cc_emails: string[] | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: Date | null;
  has_attachments: boolean;
  attachment_count: number;
  created_at: Date;
}

function fmt(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d as string).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function urgencyColor(level: string): string {
  return level === "urgent" ? "#dc2626" : level === "normal" ? "#2563eb" : "#6b7280";
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    new: "#2563eb", assigned: "#7c3aed", escalated: "#d97706",
    resolved: "#16a34a", manual_review: "#b45309", ignored: "#6b7280",
  };
  return map[status] ?? "#6b7280";
}

function sensitivityColor(level: string): string {
  const map: Record<string, string> = {
    public_internal: "#16a34a", private: "#d97706", sensitive: "#dc2626", unknown: "#6b7280",
  };
  return map[level] ?? "#6b7280";
}

const pill = (text: string, color: string) => ({
  display: "inline-block",
  padding: "2px 10px",
  borderRadius: "12px",
  fontSize: "12px",
  fontWeight: 600,
  color: "#fff",
  background: color,
  textTransform: "capitalize" as const,
});

// Strip HTML tags and decode common entities for plain-text fallback.
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default async function EmailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [email, classification, triageItem] = await Promise.all([
    queryOne<EmailDetail>(
      `SELECT id, source_inbox_email, sender_email, sender_name, recipient_emails, cc_emails,
              subject, snippet, body_text, body_html,
              received_at, has_attachments, attachment_count, created_at
       FROM inbound_emails WHERE id = $1`,
      [id]
    ),
    queryOne<EmailClassification>(
      `SELECT * FROM email_classifications
       WHERE inbound_email_id = $1 AND is_current = true
       ORDER BY created_at DESC LIMIT 1`,
      [id]
    ),
    queryOne<TriageItem>(
      `SELECT * FROM triage_items
       WHERE inbound_email_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [id]
    ),
  ]);

  if (!email) notFound();

  const senderDisplay = email.sender_name
    ? `${email.sender_name} <${email.sender_email ?? "unknown"}>`
    : (email.sender_email ?? "Unknown sender");

  const toDisplay = email.recipient_emails?.join(", ") ?? email.source_inbox_email;

  // Resolve body: plain text first, HTML stripped to text second, snippet last.
  const bodyText =
    email.body_text?.trim() ||
    (email.body_html ? stripHtml(email.body_html) : null) ||
    email.snippet ||
    null;

  const isSnippetOnly = !email.body_text && !email.body_html && !!email.snippet;

  const s = {
    page: {
      maxWidth: "860px", margin: "0 auto", padding: "32px 24px 80px",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: "14px", color: "#111827", background: "#f9fafb", minHeight: "100vh",
    } as React.CSSProperties,
    back: {
      display: "inline-flex", alignItems: "center", gap: "4px",
      fontSize: "13px", color: "#2563eb", textDecoration: "none",
      marginBottom: "20px",
    } as React.CSSProperties,
    subject: { fontSize: "20px", fontWeight: 700, color: "#111827", margin: "0 0 6px" } as React.CSSProperties,
    inboxLabel: { fontSize: "12px", color: "#6b7280", margin: "0 0 24px" } as React.CSSProperties,
    card: {
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: "10px",
      padding: "20px 24px", marginBottom: "16px",
    } as React.CSSProperties,
    cardTitle: {
      fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em",
      textTransform: "uppercase" as const, color: "#6b7280", margin: "0 0 14px",
    },
    row: { display: "flex", gap: "8px", marginBottom: "10px", alignItems: "flex-start" } as React.CSSProperties,
    label: { fontSize: "13px", fontWeight: 600, color: "#374151", minWidth: "110px", flexShrink: 0 },
    value: { fontSize: "13px", color: "#111827" },
    bodyWrap: {
      marginTop: "16px", padding: "16px 18px", background: "#f9fafb",
      borderRadius: "6px", border: "1px solid #e5e7eb",
    } as React.CSSProperties,
    bodyText: {
      margin: 0, fontSize: "13px", color: "#111827", lineHeight: "1.65",
      whiteSpace: "pre-wrap", wordBreak: "break-word" as const,
      fontFamily: "inherit",
    } as React.CSSProperties,
    snippetNote: {
      fontSize: "11px", color: "#9ca3af", fontStyle: "italic", marginTop: "8px",
    } as React.CSSProperties,
    noData: { fontSize: "13px", color: "#9ca3af", fontStyle: "italic" },
  };

  return (
    <div style={s.page}>
      <Link href="/dashboard" style={s.back}>← Back to Dashboard</Link>

      <h1 style={s.subject}>{email.subject ?? "(no subject)"}</h1>
      <p style={s.inboxLabel}>Inbox: {email.source_inbox_email}</p>

      {/* Email metadata + body */}
      <div style={s.card}>
        <div style={s.cardTitle}>Email</div>
        <div style={s.row}>
          <span style={s.label}>From</span>
          <span style={s.value}>{senderDisplay}</span>
        </div>
        <div style={s.row}>
          <span style={s.label}>To</span>
          <span style={s.value}>{toDisplay}</span>
        </div>
        {email.cc_emails && email.cc_emails.length > 0 && (
          <div style={s.row}>
            <span style={s.label}>CC</span>
            <span style={s.value}>{email.cc_emails.join(", ")}</span>
          </div>
        )}
        <div style={s.row}>
          <span style={s.label}>Received</span>
          <span style={s.value}>{fmt(email.received_at)}</span>
        </div>
        {email.has_attachments && (
          <div style={s.row}>
            <span style={s.label}>Attachments</span>
            <span style={s.value}>{email.attachment_count}</span>
          </div>
        )}

        {/* Full body */}
        {bodyText ? (
          <div style={s.bodyWrap}>
            <pre style={s.bodyText}>{bodyText}</pre>
            {isSnippetOnly && (
              <p style={s.snippetNote}>
                Full body not stored for this email — showing Gmail snippet only.
              </p>
            )}
          </div>
        ) : (
          <p style={{ ...s.noData, marginTop: "12px" }}>No email body available.</p>
        )}
      </div>

      {/* Classification */}
      {classification ? (
        <div style={s.card}>
          <div style={s.cardTitle}>AI Classification</div>
          <div style={s.row}>
            <span style={s.label}>Category</span>
            <span style={s.value}>{formatCategoryLabel(classification.primary_category)}</span>
          </div>
          <div style={s.row}>
            <span style={s.label}>Urgency</span>
            <span style={pill(classification.urgency_level, urgencyColor(classification.urgency_level))}>
              {classification.urgency_level}
            </span>
          </div>
          <div style={s.row}>
            <span style={s.label}>Sensitivity</span>
            <span style={pill(classification.sensitivity_level.replace(/_/g, " "), sensitivityColor(classification.sensitivity_level))}>
              {classification.sensitivity_level.replace(/_/g, " ")}
            </span>
          </div>
          {classification.summary && (
            <div style={s.row}>
              <span style={s.label}>Summary</span>
              <span style={s.value}>{classification.summary}</span>
            </div>
          )}
          {classification.category_tags?.length > 0 && (
            <div style={s.row}>
              <span style={s.label}>Tags</span>
              <span style={s.value}>{classification.category_tags.join(", ")}</span>
            </div>
          )}
          {classification.recommended_next_step && (
            <div style={s.row}>
              <span style={s.label}>Next Step</span>
              <span style={s.value}>{classification.recommended_next_step}</span>
            </div>
          )}
        </div>
      ) : (
        <div style={s.card}>
          <div style={s.cardTitle}>AI Classification</div>
          <p style={s.noData}>No classification on record for this email.</p>
        </div>
      )}

      {/* Triage */}
      {triageItem ? (
        <div style={s.card}>
          <div style={s.cardTitle}>Triage</div>
          <div style={s.row}>
            <span style={s.label}>Status</span>
            <span style={pill(triageItem.status.replace(/_/g, " "), statusColor(triageItem.status))}>
              {triageItem.status.replace(/_/g, " ")}
            </span>
          </div>
          <div style={s.row}>
            <span style={s.label}>Owner</span>
            <span style={s.value}>{triageItem.owner ?? "Unassigned"}</span>
          </div>
          <div style={s.row}>
            <span style={s.label}>Created</span>
            <span style={s.value}>{fmt(triageItem.created_at)}</span>
          </div>
          {triageItem.assigned_at && (
            <div style={s.row}>
              <span style={s.label}>Assigned at</span>
              <span style={s.value}>{fmt(triageItem.assigned_at)}</span>
            </div>
          )}
          {triageItem.resolved_at && (
            <div style={s.row}>
              <span style={s.label}>Resolved at</span>
              <span style={s.value}>{fmt(triageItem.resolved_at)}</span>
            </div>
          )}
          {triageItem.escalated_at && (
            <div style={s.row}>
              <span style={s.label}>Escalated at</span>
              <span style={s.value}>{fmt(triageItem.escalated_at)}</span>
            </div>
          )}
        </div>
      ) : (
        <div style={s.card}>
          <div style={s.cardTitle}>Triage</div>
          <p style={s.noData}>No triage record for this email.</p>
        </div>
      )}
    </div>
  );
}
