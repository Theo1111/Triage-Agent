const TORONTO_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

// Formats a date as "Jul 3, 2026, 11:09 AM ET" in America/Toronto time.
// Accepts a Date, ISO string, or null/undefined.
export function formatTorontoDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return TORONTO_FMT.format(date) + " ET";
}

// Short form without year — for dashboard table cells where space is tight.
// e.g. "Jul 3, 11:09 AM ET"
const TORONTO_SHORT_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatTorontoDateTimeShort(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "—";
  return TORONTO_SHORT_FMT.format(date) + " ET";
}
