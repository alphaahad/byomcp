import type React from "react";
import type { UsageDay } from "@/server/workspaces/usage";
import { USAGE_DAYS, USAGE_TZ } from "@/server/workspaces/usage";

/** Dates on the Usage pages are shown in the owner's time zone (the server runs in UTC). */
export function fmt(date: Date | null, style: "datetime" | "date" = "datetime"): string {
  if (!date) return "Never";
  return date.toLocaleString("en-GB", {
    timeZone: USAGE_TZ,
    dateStyle: "medium",
    ...(style === "datetime" ? { timeStyle: "short" } : {}),
  });
}

const SERIES: { key: keyof Omit<UsageDay, "day">; label: string; unit: [string, string] }[] = [
  { key: "calls", label: "Calls to apps", unit: ["call", "calls"] },
  { key: "aiImports", label: "AI imports", unit: ["import", "imports"] },
  { key: "chats", label: "Test-chat messages", unit: ["message", "messages"] },
  { key: "signIns", label: "Sign-ins", unit: ["sign-in", "sign-ins"] },
];

const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Four small bar charts, one per kind of activity, over the last 30 days. */
export function DailyCharts({ days }: { days: UsageDay[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {SERIES.map((s) => {
        const values = days.map((d) => d[s.key]);
        const max = Math.max(1, ...values);
        const total = values.reduce((a, b) => a + b, 0);
        const busy = days.filter((d) => d[s.key] > 0);
        const say = (n: number) => `${n} ${n === 1 ? s.unit[0] : s.unit[1]}`;
        return (
          <figure key={s.key} className="flex flex-col gap-2">
            <figcaption className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-semibold">{s.label}</span>
              <span className="text-ink-soft tabular-nums">
                {say(total)} in {USAGE_DAYS} days
              </span>
            </figcaption>
            <div aria-hidden className="flex h-16 items-end gap-[2px] border-b border-[var(--separator)]">
              {days.map((d) => {
                const v = d[s.key];
                return (
                  <div
                    key={d.day}
                    title={`${dayLabel(d.day)}: ${say(v)}`}
                    className="min-w-0 flex-1 rounded-t-[2px]"
                    style={{
                      height: v ? `${Math.max(8, (v / max) * 100)}%` : "2px",
                      background: v ? "var(--signal)" : "var(--separator)",
                    }}
                  />
                );
              })}
            </div>
            <div aria-hidden className="flex justify-between text-xs text-ink-soft">
              <span>{dayLabel(days[0].day)}</span>
              <span>{dayLabel(days[days.length - 1].day)}</span>
            </div>
            <p className="sr-only">
              {busy.length === 0 ? `No ${s.unit[1]} in the last ${USAGE_DAYS} days.` : busy.map((d) => `${dayLabel(d.day)}: ${say(d[s.key])}`).join("; ")}
            </p>
          </figure>
        );
      })}
    </div>
  );
}

export const SOURCE_LABEL: Record<string, string> = { mcp: "AI employee", try_it: "Try it", approval: "Approval" };

export const STATUS_LABEL: Record<string, { text: string; tone: "ok" | "alarm" | "warn" | "quiet" }> = {
  success: { text: "Worked", tone: "ok" },
  empty_or_invalid: { text: "Empty or invalid", tone: "alarm" },
  auth_failed: { text: "Key rejected", tone: "alarm" },
  transient_failed: { text: "App unavailable", tone: "alarm" },
  request_error: { text: "Request error", tone: "alarm" },
  validation_error: { text: "Bad input", tone: "warn" },
  pending_approval: { text: "Waiting for approval", tone: "warn" },
  rejected: { text: "Rejected", tone: "quiet" },
};

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  openapi_url: "OpenAPI link (no AI)",
  openapi_file: "OpenAPI file (no AI)",
  docs_url: "Docs page (AI)",
  text: "Pasted text (AI)",
  pdf: "PDF (AI)",
};

/** Numbers in a grid that wraps on phones (2 across) instead of truncating. */
export function Stats({ items }: { items: { value: React.ReactNode; label: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {items.map((m) => (
        <div key={m.label} className="flex min-w-0 flex-col-reverse border-l-2 border-[var(--separator)] pl-3">
          <dt className="text-xs text-ink-soft">{m.label}</dt>
          <dd className="text-[1.0625rem] font-semibold tabular-nums">{m.value}</dd>
        </div>
      ))}
    </dl>
  );
}
