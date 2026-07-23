"use client";

import { useEffect, useState } from "react";
import styles from "./dashboard.module.css";
import { formatTorontoDateTime } from "@/src/lib/formatDate";
import type { TimelineEvent, CaseMessage } from "@/src/services/caseTimeline";

interface Props {
  triageItemId: string;
}

const CATEGORY_ICON: Record<string, string> = {
  email_received: "📨",
  reply_received: "↩️",
  created: "🆕",
  classified: "🤖",
  classification_failed: "⚠️",
  routed_slack: "💬",
  routed_slack_failed: "⚠️",
  routed_slack_blocked: "🔒",
  assigned: "👤",
  unassigned: "🚫",
  escalated: "🔺",
  unescalated: "↘️",
  resolved: "🟢",
  reopened: "🔄",
  archived: "🗄️",
  restored: "↩️",
  summary_edited: "✏️",
  other: "•",
};

export default function CaseTimelineView({ triageItemId }: Props) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [messages, setMessages] = useState<CaseMessage[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setErrorMsg(null);
    fetch(`/api/dashboard/triage/timeline?triageItemId=${encodeURIComponent(triageItemId)}`)
      .then(async res => {
        const json = (await res.json()) as {
          ok?: boolean;
          events?: TimelineEvent[];
          messages?: CaseMessage[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setErrorMsg(json.error ?? `HTTP ${res.status}`);
          setState("error");
          return;
        }
        setEvents(json.events ?? []);
        setMessages(json.messages ?? []);
        setState("ready");
      })
      .catch(err => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Network error");
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [triageItemId]);

  return (
    <>
      {messages.length > 1 && (
        <div className={styles.drawerSection}>
          <div className={styles.drawerSectionTitle}>
            Thread messages
            <span className={styles.drawerCountPill}>{messages.length}</span>
          </div>
          <div className={styles.threadMsgList}>
            {messages.map((m, i) => (
              <div key={m.inboundEmailId} className={styles.threadMsg}>
                <div className={styles.threadMsgHead}>
                  <span className={styles.threadMsgFrom}>
                    {m.senderName || m.senderEmail || "Unknown"}
                  </span>
                  <span className={styles.threadMsgTime}>{formatTorontoDateTime(m.receivedAt)}</span>
                </div>
                {m.snippet && <div className={styles.threadMsgSnippet}>{m.snippet}</div>}
                <a className={styles.threadMsgLink} href={`/emails/${m.inboundEmailId}`}>
                  Open message {i + 1}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.drawerSection}>
        <div className={styles.drawerSectionTitle}>Activity</div>
        {state === "loading" && <div className={styles.timelineMuted}>Loading activity…</div>}
        {state === "error" && (
          <div className={styles.timelineError}>Could not load activity: {errorMsg}</div>
        )}
        {state === "ready" && events.length === 0 && (
          <div className={styles.timelineMuted}>No recorded activity yet.</div>
        )}
        {state === "ready" && events.length > 0 && (
          <ol className={styles.timeline}>
            {events.map(ev => (
              <li key={ev.id} className={styles.timelineItem}>
                <span className={styles.timelineIcon} aria-hidden="true">
                  {CATEGORY_ICON[ev.category] ?? "•"}
                </span>
                <div className={styles.timelineBody}>
                  <div className={styles.timelineTitle}>{ev.title}</div>
                  {ev.detail && <div className={styles.timelineDetail}>{ev.detail}</div>}
                  <div className={styles.timelineMeta}>
                    {ev.actor} · {formatTorontoDateTime(ev.at)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
