"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { EvidenceLabel, RiskLabel } from "@/components/ui";
import { HTTP_METHODS, LARGE_SPEC_THRESHOLD, MANY_TOOLS_WARNING, RISK_TIERS, riskFromMethod, riskRank, type Evidence, type HttpMethod, type JsonSchemaObject, type RiskTier } from "@/lib/ir";
import { bestRead } from "@/lib/best-read";
import { bulkAction, updateActionAction } from "./actions";
import { TryIt } from "./try-it";

export type ReviewAction = {
  id: string;
  key: string;
  title: string;
  description: string;
  resource: string;
  method: HttpMethod;
  path: string;
  params: { path: JsonSchemaObject; query: JsonSchemaObject; headers: JsonSchemaObject; body?: JsonSchemaObject };
  risk: RiskTier;
  evidence: Evidence;
  citation: { url?: string; quote: string } | null;
  enabled: boolean;
  requiresApproval: boolean;
  lastTestedAt: string | null;
};

type Props = { versionId: string; actions: ReviewAction[]; connected: boolean; editable: boolean; connectorId: string; autoTry?: boolean };

/** Docs descriptions often carry Markdown (headings, bullets, code ticks); show them as plain text. */
function plainText(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[*-]\s+/gm, "• ")
    .replace(/[`*_]{1,3}([^`*_\n]+)[`*_]{1,3}/g, "$1")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
}

export function ReviewList({ versionId, actions, connected, editable, connectorId, autoTry }: Props) {
  // Prefer a read a newcomer can run without knowing any IDs (src/lib/best-read.ts).
  const autoTryId = autoTry ? (bestRead(actions, { onlyEnabled: true }) ?? actions.find((a) => a.enabled && a.risk === "read"))?.id : undefined;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [onlyOn, setOnlyOn] = useState(false);
  const large = actions.length > LARGE_SPEC_THRESHOLD;
  const onCount = actions.filter((a) => a.enabled).length;

  const q = query.trim().toLowerCase();
  const visible = actions.filter(
    (a) =>
      (!onlyOn || a.enabled) &&
      (!q || a.title.toLowerCase().includes(q) || a.resource.toLowerCase().includes(q) || a.key.includes(q) || a.path.toLowerCase().includes(q)),
  );
  const groups = new Map<string, ReviewAction[]>();
  for (const a of visible) groups.set(a.resource, [...(groups.get(a.resource) ?? []), a]);
  const allGroups = new Map<string, ReviewAction[]>();
  for (const a of actions) allGroups.set(a.resource, [...(allGroups.get(a.resource) ?? []), a]);

  const bulk = (mode: "reads_on" | "all_off", resource?: string) =>
    start(async () => {
      const r = await bulkAction(versionId, mode, resource);
      if (!r.ok) setError(r.error);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      {large && (
        <div className="flex flex-col gap-1">
          <p className="text-[1.0625rem] font-semibold">Choose what your AI employee needs</p>
          <p className="text-sm text-ink-soft">
            This API has {actions.length} actions in {allGroups.size} groups, so nothing starts on. Search for the jobs you have in mind
            (like &quot;ticket&quot; or &quot;user&quot;) and turn on just those. Models choose tools best from a short list.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${actions.length} actions`}
          aria-label="Search actions"
          className="field max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="chk" checked={onlyOn} onChange={(e) => setOnlyOn(e.target.checked)} />
          Only show what&apos;s on
        </label>
        {editable && (
          <div className="ml-auto flex flex-wrap gap-2" aria-label="Turn many actions on or off">
            {!large && (
              <button type="button" className="btn btn-sm" disabled={pending} onClick={() => bulk("reads_on")}>
                Turn on all reads
              </button>
            )}
            <button type="button" className="btn btn-sm" disabled={pending || onCount === 0} onClick={() => bulk("all_off")}>
              Turn everything off
            </button>
          </div>
        )}
      </div>

      <p className={`text-sm ${onCount > MANY_TOOLS_WARNING ? "text-warn font-semibold" : "text-ink-soft"}`} role="status">
        {onCount} {onCount === 1 ? "tool" : "tools"} on
        {onCount > MANY_TOOLS_WARNING
          ? `: that's a lot. Models choose tools less reliably past about ${MANY_TOOLS_WARNING}, so consider turning off what this AI employee won't use.`
          : "."}
      </p>

      {error && (
        <p role="alert" className="text-alarm">
          ⚠ {error}
        </p>
      )}
      {visible.length === 0 && <p className="text-ink-soft">No actions match. Try another word.</p>}
      {[...groups.entries()].map(([resource, items]) => {
        const all = allGroups.get(resource) ?? items;
        const on = all.filter((a) => a.enabled).length;
        const reads = all.filter((a) => a.risk === "read").length;
        return (
          <details key={resource} className="window overflow-hidden px-4 pt-3 pb-4" open={!large || !!q || onlyOn || on > 0}>
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 py-1 [&::-webkit-details-marker]:hidden">
              <span className="font-semibold">{resource}</span>
              <span className="text-sm text-ink-soft">
                {all.length} {all.length === 1 ? "action" : "actions"}
                {on ? ` · ${on} on` : ""}
              </span>
              {editable && (
                <span className="ml-auto flex gap-1.5">
                  {reads > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={pending}
                      onClick={(e) => {
                        e.preventDefault();
                        bulk("reads_on", resource);
                      }}
                    >
                      Turn on reads
                    </button>
                  )}
                  {on > 0 && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={pending}
                      onClick={(e) => {
                        e.preventDefault();
                        bulk("all_off", resource);
                      }}
                    >
                      Turn off
                    </button>
                  )}
                </span>
              )}
            </summary>
            <ul className="mt-3 -mx-4 -mb-4 divide-y divide-[var(--separator)] border-t border-[var(--separator)]">
              {items.map((a) => (
                <ActionRow key={a.id} action={a} connected={connected} editable={editable} connectorId={connectorId} openTry={a.id === autoTryId} />
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

function ActionRow({
  action: a,
  connected,
  editable,
  connectorId,
  openTry,
}: {
  action: ReviewAction;
  connected: boolean;
  editable: boolean;
  connectorId: string;
  openTry?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [open, setOpen] = useState(false);
  const [trying, setTrying] = useState(!!openTry);
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!openTry) return;
    // After Next restores scroll position on navigation.
    const t = setTimeout(() => rowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 400);
    return () => clearTimeout(t);
  }, [openTry]);

  const save = (patch: Parameters<typeof updateActionAction>[1], after?: () => void) =>
    start(async () => {
      const r = await updateActionAction(a.id, patch);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setError(null);
      after?.();
      router.refresh();
    });

  const destructive = a.risk === "destructive";
  const disabledReason = !editable ? "This version is published." : undefined;

  return (
    <li ref={rowRef} className={`flex flex-col gap-2 px-4 py-3 ${openTry ? "ring-2 ring-[var(--signal)] ring-inset" : ""} ${pending ? "opacity-70" : ""} ${a.enabled ? "" : "bg-[color-mix(in_srgb,var(--bg)_60%,transparent)]"}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2" title={disabledReason}>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={a.enabled}
            disabled={!editable || pending}
            onChange={(e) => save({ enabled: e.target.checked })}
            aria-label={`Let your AI employee use "${a.title}"`}
          />
          <span className="w-6 text-xs font-medium text-ink-soft" aria-hidden>
            {a.enabled ? "On" : "Off"}
          </span>
        </label>

        {renaming ? (
          <form
            className="flex flex-1 flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const title = String(new FormData(e.currentTarget).get("title") ?? "");
              save({ title }, () => setRenaming(false));
            }}
          >
            <input name="title" defaultValue={a.title} className="field min-w-48 flex-1" aria-label="Action name" autoFocus maxLength={120} />
            <button type="submit" className="btn btn-sm">
              Save
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <span className="min-w-40 flex-1 font-semibold">{a.title}</span>
        )}

        <span className="text-sm">
          <RiskLabel risk={a.risk} />
        </span>
        <span className="text-sm">
          <EvidenceLabel evidence={a.evidence} />
        </span>
        <label className="flex items-center gap-2 text-sm" title={destructive ? "Destructive actions always need approval." : disabledReason}>
          <input
            type="checkbox"
            className="chk"
            checked={a.requiresApproval}
            disabled={!editable || pending || destructive}
            onChange={(e) => save({ requiresApproval: e.target.checked })}
          />
          Needs approval{destructive ? " (always)" : ""}
        </label>
        <div className="ml-auto flex gap-2">
          {a.risk === "read" && (
            <button type="button" className="btn btn-sm" onClick={() => setTrying((t) => !t)} aria-expanded={trying}>
              Try it
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide details" : "Details"}
          </button>
        </div>
      </div>

      <p className="text-sm text-ink-soft">{plainText(a.description)}</p>

      {error && (
        <p role="alert" className="text-sm text-alarm">
          ⚠ {error}
        </p>
      )}

      {trying &&
        (connected ? (
          <TryIt action={a} onDone={() => router.refresh()} />
        ) : (
          <p className="bevel-in p-3 text-sm">
            ℹ Connect your account first, then you can run this read action for real. <Link href={`/apps/${connectorId}/connect`}>Connect your account</Link>
          </p>
        ))}

      {open && <Details action={a} editable={editable} pending={pending} onRename={() => setRenaming(true)} save={save} />}
    </li>
  );
}

function Details({
  action: a,
  editable,
  pending,
  onRename,
  save,
}: {
  action: ReviewAction;
  editable: boolean;
  pending: boolean;
  onRename: () => void;
  save: (patch: Parameters<typeof updateActionAction>[1], after?: () => void) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const minRisk = riskFromMethod(a.method);

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--separator)] pt-3 text-sm">
      <div className="flex flex-col gap-1">
        <span className="font-semibold">Why we think this exists</span>
        {a.citation ? (
          <blockquote className="bevel-in p-2 font-mono text-xs">
            “{a.citation.quote}”
            {a.citation.url && (
              <>
                {" "}
                <a href={a.citation.url} target="_blank" rel="noreferrer noopener">
                  source
                </a>
              </>
            )}
          </blockquote>
        ) : (
          <p>
            <EvidenceLabel evidence="needs_review" />: we couldn&apos;t match this to an exact line in the docs. Check it against the docs, then try it.
          </p>
        )}
        {a.lastTestedAt && <p>Last tested {new Date(a.lastTestedAt).toLocaleString()}.</p>}
      </div>

      {editable && (
        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            save({ description: String(new FormData(e.currentTarget).get("description") ?? "") });
          }}
        >
          <label htmlFor={`desc-${a.id}`} className="font-semibold">
            Description (your AI employee reads this too)
          </label>
          <textarea id={`desc-${a.id}`} name="description" defaultValue={a.description} rows={2} maxLength={1000} className="field" />
          <div className="flex gap-2">
            <button type="submit" className="btn btn-sm" disabled={pending}>
              Save description
            </button>
            <button type="button" className="btn btn-sm" onClick={onRename}>
              Rename
            </button>
          </div>
        </form>
      )}

      <div>
        <button type="button" className="btn btn-sm" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
          {advanced ? "Hide advanced" : "Advanced"}
        </button>
      </div>

      {advanced && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            save({
              method: String(f.get("method")) as HttpMethod,
              path: String(f.get("path")),
              risk: String(f.get("risk")) as RiskTier,
              paramsJson: String(f.get("params")),
            });
          }}
        >
          <p className="text-ink-soft">
            Changing the request resets its evidence to &quot;Needs review&quot; until you try it again.
          </p>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={`m-${a.id}`} className="font-semibold">
                Method
              </label>
              <select id={`m-${a.id}`} name="method" defaultValue={a.method} className="field" disabled={!editable}>
                {HTTP_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="flex min-w-64 flex-1 flex-col gap-1">
              <label htmlFor={`p-${a.id}`} className="font-semibold">
                Path
              </label>
              <input id={`p-${a.id}`} name="path" defaultValue={a.path} className="field font-mono" disabled={!editable} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`r-${a.id}`} className="font-semibold">
                Risk
              </label>
              <select id={`r-${a.id}`} name="risk" defaultValue={a.risk} className="field" disabled={!editable}>
                {RISK_TIERS.map((r) => (
                  <option key={r} value={r} disabled={riskRank(r) < riskRank(minRisk)}>
                    {r === "read" ? "Read" : r === "write" ? "Write" : "Destructive"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`j-${a.id}`} className="font-semibold">
              Inputs (JSON Schema)
            </label>
            <textarea
              id={`j-${a.id}`}
              name="params"
              defaultValue={JSON.stringify(a.params, null, 2)}
              rows={12}
              spellCheck={false}
              className="field font-mono text-xs"
              disabled={!editable}
            />
            <p className="text-ink-soft">Key: <span className="font-mono">{a.key}</span></p>
          </div>
          {editable && (
            <div>
              <button type="submit" className="btn btn-sm" disabled={pending}>
                Save advanced changes
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
