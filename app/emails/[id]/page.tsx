import { notFound } from "next/navigation";
import Link from "next/link";
import { queryOne } from "@/src/lib/db";
import { formatCategoryLabel } from "@/src/lib/formatCategory";
import { formatTorontoDateTime } from "@/src/lib/formatDate";
import { deriveTriageDisplayState } from "@/src/lib/triageDisplayState";
import * as inboundEmailsRepo from "@/src/repositories/inboundEmailsRepository";
import { cleanEmailBodyForTriage } from "@/src/lib/cleanEmailBody";
import type { InboundEmail, EmailClassification, TriageItem } from "@/src/types/database";

export const dynamic = "force-dynamic";

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

function resolveBody(email: InboundEmail): { text: string | null; isSnippetOnly: boolean } {
  if (email.body_text?.trim()) return { text: email.body_text.trim(), isSnippetOnly: false };
  if (email.body_html) return { text: stripHtml(email.body_html), isSnippetOnly: false };
  if (email.snippet) return { text: email.snippet, isSnippetOnly: true };
  return { text: null, isSnippetOnly: false };
}

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
  cardHighlighted: {
    background: "#fff", border: "2px solid #2563eb", borderRadius: "10px",
    padding: "20px 24px", marginBottom: "16px",
  } as React.CSSProperties,
  cardTitle: {
    fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase" as const, color: "#6b7280", margin: "0 0 14px",
  },
  triggerBadge: {
    display: "inline-block", fontSize: "11px", fontWeight: 700,
    background: "#dbeafe", color: "#1d4ed8", borderRadius: "8px",
    padding: "2px 8px", marginLeft: "8px", verticalAlign: "middle",
  } as React.CSSProperties,
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
  rawToggle: {
    marginTop: "12px", fontSize: "11px", color: "#6b7280",
  } as React.CSSProperties,
  rawToggleSummary: {
    cursor: "pointer", userSelect: "none" as const, color: "#6b7280",
    fontSize: "11px", fontStyle: "italic",
  } as React.CSSProperties,
  rawBodyWrap: {
    marginTop: "8px", padding: "12px 14px", background: "#f3f4f6",
    borderRadius: "4px", border: "1px dashed #d1d5db",
  } as React.CSSProperties,
  noData: { fontSize: "13px", color: "#9ca3af", fontStyle: "italic" },
  threadNote: {
    fontSize: "12px", color: "#9ca3af", fontStyle: "italic",
    textAlign: "center" as const, padding: "12px 0",
  } as React.CSSProperties,
  sectionHeader: {
    fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase" as const, color: "#9ca3af",
    margin: "28px 0 12px", display: "flex", alignItems: "center", gap: "8px",
  } as React.CSSProperties,
  divider: {
    flex: 1, height: "1px", background: "#e5e7eb",
  } as React.CSSProperties,
};

export default async function EmailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Load the target email first.
  const targetEmail = await inboundEmailsRepo.findById(id);
  if (!targetEmail) notFound();

  const gmailThreadId = targetEmail.gmail_thread_id;

  // Fetch all emails in the thread (chronological), the triage item for the thread,
  // and the classification for the target email.
  const [threadEmails, triageItem, classification] = await Promise.all([
    gmailThreadId
      ? inboundEmailsRepo.findByThreadId(gmailThreadId)
      : Promise.resolve([targetEmail]),
    gmailThreadId
      ? queryOne<TriageItem>(
          `SELECT ti.* FROM triage_items ti
           JOIN inbound_emails ie ON ie.id = ti.inbound_email_id
           WHERE ie.gmail_thread_id = $1
           ORDER BY ti.created_at ASC LIMIT 1`,
          [gmailThreadId]
        )
      : queryOne<TriageItem>(
          `SELECT * FROM triage_items WHERE inbound_email_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [id]
        ),
    queryOne<EmailClassification>(
      `SELECT * FROM email_classifications
       WHERE inbound_email_id = $1 AND is_current = true
       ORDER BY created_at DESC LIMIT 1`,
      [id]
    ),
  ]);

  // If findByThreadId returned nothing (edge case), fall back to the target alone.
  const messages = threadEmails.length > 0 ? threadEmails : [targetEmail];
  const isSingleMessage = messages.length === 1;

  const displayState = triageItem ? deriveTriageDisplayState(triageItem) : null;

  return (
    <div style={s.page}>
      <Link href="/dashboard" style={s.back}>← Back to Dashboard</Link>

      <h1 style={s.subject}>{targetEmail.subject ?? "(no subject)"}</h1>
      <p style={s.inboxLabel}>Inbox: {targetEmail.source_inbox_email}</p>

      {/* ── Triage context (thread-level) ── */}
      {triageItem ? (
        <div style={s.card}>
          <div style={s.cardTitle}>Triage</div>
          <div style={s.row}>
            <span style={s.label}>Status</span>
            <span style={pill(triageItem.status.replace(/_/g, " "), statusColor(triageItem.status))}>
              {triageItem.status.replace(/_/g, " ")}
            </span>
            {displayState?.isEscalated && (
              <span style={{ ...pill("escalated", "#d97706"), marginLeft: "6px" }}>escalated</span>
            )}
          </div>
          <div style={s.row}>
            <span style={s.label}>Owner</span>
            <span style={s.value}>{triageItem.owner ?? "Unassigned"}</span>
          </div>
          <div style={s.row}>
            <span style={s.label}>Urgency</span>
            <span style={pill(triageItem.urgency_level ?? "unknown", urgencyColor(triageItem.urgency_level ?? "unknown"))}>
              {triageItem.urgency_level ?? "unknown"}
            </span>
          </div>
          <div style={s.row}>
            <span style={s.label}>Created</span>
            <span style={s.value}>{formatTorontoDateTime(triageItem.created_at)}</span>
          </div>
          {triageItem.assigned_at && (
            <div style={s.row}>
              <span style={s.label}>Assigned at</span>
              <span style={s.value}>{formatTorontoDateTime(triageItem.assigned_at)}</span>
            </div>
          )}
          {triageItem.escalated_at && (
            <div style={s.row}>
              <span style={s.label}>Escalated at</span>
              <span style={s.value}>{formatTorontoDateTime(triageItem.escalated_at)}</span>
            </div>
          )}
          {triageItem.resolved_at && (
            <div style={s.row}>
              <span style={s.label}>Resolved at</span>
              <span style={s.value}>{formatTorontoDateTime(triageItem.resolved_at)}</span>
            </div>
          )}

        </div>
      ) : (
        <div style={s.card}>
          <div style={s.cardTitle}>Triage</div>
          <p style={s.noData}>No triage record for this thread.</p>
        </div>
      )}

      {/* ── AI Classification (for the triage-triggering email) ── */}
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

      {/* ── Thread messages ── */}
      <div style={s.sectionHeader}>
        <span>Email Thread</span>
        <div style={s.divider} />
        <span style={{ whiteSpace: "nowrap" }}>{messages.length} message{messages.length !== 1 ? "s" : ""}</span>
      </div>

      {messages.map((msg, idx) => {
        const isTarget = msg.id === id;
        const senderDisplay = msg.sender_name
          ? `${msg.sender_name} <${msg.sender_email ?? "unknown"}>`
          : (msg.sender_email ?? "Unknown sender");
        const toDisplay = msg.recipient_emails?.join(", ") ?? msg.source_inbox_email;
        const { text: bodyText, isSnippetOnly } = resolveBody(msg);
        const cleanedBody = bodyText && !isSnippetOnly ? cleanEmailBodyForTriage(bodyText) : null;
        const bodyChanged = cleanedBody !== null && cleanedBody !== bodyText;

        return (
          <div key={msg.id} style={isTarget ? s.cardHighlighted : s.card}>
            <div style={s.cardTitle}>
              Message {idx + 1}
              {isTarget && (
                <span style={s.triggerBadge}>Triage-triggering message</span>
              )}
            </div>

            <div style={s.row}>
              <span style={s.label}>From</span>
              <span style={s.value}>{senderDisplay}</span>
            </div>
            <div style={s.row}>
              <span style={s.label}>To</span>
              <span style={s.value}>{toDisplay}</span>
            </div>
            {msg.cc_emails && msg.cc_emails.length > 0 && (
              <div style={s.row}>
                <span style={s.label}>CC</span>
                <span style={s.value}>{msg.cc_emails.join(", ")}</span>
              </div>
            )}
            <div style={s.row}>
              <span style={s.label}>Received</span>
              <span style={s.value}>{formatTorontoDateTime(msg.received_at)}</span>
            </div>
            {msg.has_attachments && (
              <div style={s.row}>
                <span style={s.label}>Attachments</span>
                <span style={s.value}>{msg.attachment_count}</span>
              </div>
            )}

            {(cleanedBody || bodyText) ? (
              <div style={s.bodyWrap}>
                <pre style={s.bodyText}>{cleanedBody ?? bodyText}</pre>
                {isSnippetOnly && (
                  <p style={s.snippetNote}>
                    Full body not stored — showing Gmail snippet only.
                  </p>
                )}
                {bodyChanged && (
                  <details style={s.rawToggle}>
                    <summary style={s.rawToggleSummary}>Show raw body (includes signatures, tracking links)</summary>
                    <div style={s.rawBodyWrap}>
                      <pre style={{ ...s.bodyText, color: "#6b7280" }}>{bodyText}</pre>
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <p style={{ ...s.noData, marginTop: "12px" }}>No email body available.</p>
            )}
          </div>
        );
      })}

      {isSingleMessage && (
        <p style={s.threadNote}>No other stored messages found in this thread.</p>
      )}
    </div>
  );
}
