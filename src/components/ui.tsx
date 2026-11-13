/**
 * UI kit, in the UnleashX design language (docs/DESIGN.md): cards, tags,
 * chips, metric rows, page headers, notices. Server-component friendly.
 * Colour is never the only signal: every tag carries a word.
 */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { Evidence, RiskTier } from "@/lib/ir";
import { IconSpark } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/** Card with an optional title row and footnotes. (Named Window for history.) */
export function Window({
  title,
  children,
  status,
  className,
  titleRight,
  as: Tag = "section",
}: {
  title?: ReactNode;
  children: ReactNode;
  status?: ReactNode[];
  className?: string;
  titleRight?: ReactNode;
  as?: "section" | "main" | "div";
}) {
  return (
    <Tag className={cx("window", className)}>
      {(title || titleRight) && (
        <div className="titlebar">
          {title ? <h2 className="min-w-0 text-balance">{title}</h2> : <span />}
          {titleRight}
        </div>
      )}
      <div className={cx("px-5 pb-5", title || titleRight ? "pt-3" : "pt-5")}>{children}</div>
      {status && status.length > 0 && (
        <div className="statusbar" role="status">
          {status.map((s, i) => (
            <span key={i}>{s}</span>
          ))}
        </div>
      )}
    </Tag>
  );
}

/** Page title + one-line explanation + optional actions on the right. */
export function PageHeader({ title, lead, actions }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[1.625rem] font-semibold tracking-tight">{title}</h1>
        {lead && <p className="mt-1 max-w-2xl text-ink-soft">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function GroupBox({ legend, children, className }: { legend: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cx("groupbox", className)}>
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}

type BtnProps = { primary?: boolean; small?: boolean };

export function Button({ primary, small, className, ...rest }: ComponentProps<"button"> & BtnProps) {
  return <button className={cx("btn", primary && "btn-primary", small && "btn-sm", className)} {...rest} />;
}

export function ButtonLink({ primary, small, className, ...rest }: ComponentProps<typeof Link> & BtnProps) {
  return <Link className={cx("btn", primary && "btn-primary", small && "btn-sm", className)} {...rest} />;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "alarm" | "ok"; children: ReactNode }) {
  const style =
    tone === "alarm"
      ? "border-[color-mix(in_srgb,var(--alarm)_35%,transparent)] bg-[var(--alarm-tint)]"
      : tone === "ok"
        ? "border-[color-mix(in_srgb,var(--ok)_35%,transparent)] bg-[var(--ok-tint)]"
        : "border-[color-mix(in_srgb,var(--signal)_30%,transparent)] bg-[var(--signal-tint)]";
  return (
    <div role={tone === "alarm" ? "alert" : "status"} className={cx("rounded-[var(--radius-sm)] border p-3.5", style)}>
      {children}
    </div>
  );
}

/** Tinted tag. Tones map to the design's category colours. */
export function Tag({
  children,
  tone = "violet",
  icon,
  title,
}: {
  children: ReactNode;
  tone?: "violet" | "green" | "orange" | "blue" | "red" | "grey";
  icon?: ReactNode;
  title?: string;
}) {
  const cls = { violet: "", green: "text-ok", orange: "text-warn", blue: "text-info", red: "text-alarm", grey: "stamp-quiet" }[tone];
  return (
    <span className={cx("stamp", cls)} title={title}>
      {icon}
      {children}
    </span>
  );
}

/** "AI used here" / "No AI" marker: answers "where is the AI?" wherever it matters. */
export function AiTag({ used, note }: { used: boolean; note?: string }) {
  return used ? (
    <Tag tone="violet" icon={<IconSpark size={14} />} title="This step uses AI, once.">
      AI {note ? `· ${note}` : "used here"}
    </Tag>
  ) : (
    <Tag tone="grey" title="No AI in this step.">
      No AI{note ? ` · ${note}` : ""}
    </Tag>
  );
}

/** Metrics row with dividers (value over label), like the Workforce cards. */
export function MetricRow({ items }: { items: { value: ReactNode; label: string }[] }) {
  return (
    <dl className="grid divide-x divide-[var(--separator)] border-y border-[var(--separator)] py-2.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((m) => (
        <div key={m.label} className="min-w-0 px-3 first:pl-0">
          <dt className="sr-only">{m.label}</dt>
          <dd className="truncate text-[1.0625rem] font-semibold tabular-nums">{m.value}</dd>
          <dd aria-hidden className="truncate text-xs text-ink-soft">
            {m.label}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Coloured monogram tile (no third-party logos). */
export function Monogram({ name, size = 40 }: { name: string; size?: number }) {
  const palette = ["#6d28d9", "#1d4ed8", "#c2410c", "#15803d", "#be185d", "#0e7490"];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = palette[h % palette.length];
  const letters = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[10px] font-semibold text-white"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.4 }}
    >
      {letters}
    </span>
  );
}

/** Small "?" with an explanation, for jargon (MCP, evidence, approval, token). */
export function Help({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="relative inline-block align-middle">
      <summary
        className="inline-flex h-4.5 w-4.5 cursor-pointer list-none items-center justify-center rounded-full border border-[var(--separator)] text-[0.7rem] font-semibold text-ink-soft hover:border-[var(--signal)] hover:text-signal"
        aria-label={`What is ${label}?`}
      >
        ?
      </summary>
      <div className="window absolute top-6 left-0 z-20 w-72 p-3 text-sm font-normal text-ink">{children}</div>
    </details>
  );
}

const RISK: Record<RiskTier, { label: string; tone: "grey" | "orange" | "red"; title: string }> = {
  read: { label: "Read", tone: "grey", title: "Only looks things up. Runs without approval." },
  write: { label: "Changes data", tone: "orange", title: "Creates or updates data. Can need approval." },
  destructive: { label: "Destructive", tone: "red", title: "Deletes or can't be undone. Always needs approval." },
};

export function RiskLabel({ risk }: { risk: RiskTier }) {
  const r = RISK[risk];
  return (
    <Tag tone={r.tone} title={r.title}>
      {r.label}
    </Tag>
  );
}

const EVIDENCE: Record<Evidence, { label: string; tone: "green" | "blue" | "grey"; title: string }> = {
  tested: { label: "Tested", tone: "green", title: "We ran it against your account and it worked." },
  sourced: { label: "From the docs", tone: "blue", title: "Found in the docs, with a quote you can check." },
  needs_review: { label: "Needs review", tone: "grey", title: "We couldn't match it to an exact line in the docs." },
};

export function EvidenceLabel({ evidence }: { evidence: Evidence }) {
  const e = EVIDENCE[evidence];
  return (
    <Tag tone={e.tone} title={e.title}>
      {evidence === "tested" && "✓ "}
      {e.label}
    </Tag>
  );
}

/** A decision/status tag, e.g. Approved · done / Rejected / Published. */
export function Stamp({ children, tone = "signal" }: { children: ReactNode; tone?: "signal" | "ok" | "alarm" | "quiet" }) {
  const map = { signal: "violet", ok: "green", alarm: "red", quiet: "grey" } as const;
  return <Tag tone={map[tone]}>{children}</Tag>;
}

export function StatusDot({ tone, children }: { tone: "ok" | "alarm" | "warn" | "quiet"; children: ReactNode }) {
  const color = { ok: "var(--ok)", alarm: "var(--alarm)", warn: "var(--warn)", quiet: "var(--ink-soft)" }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

export function formatUsd(n: number | null | undefined): string {
  const v = n ?? 0;
  return `$${v.toFixed(v > 0 && v < 0.01 ? 4 : 2)}`;
}
