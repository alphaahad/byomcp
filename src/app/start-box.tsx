"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { IconArrowRight, IconDoc, IconLink, IconSearch } from "@/components/icons";
import { Monogram, Tag } from "@/components/ui";
import { CATALOG } from "@/lib/catalog";
import { RequestApp } from "./request-app";
import { startFromLink, type StartState } from "./start-actions";

/**
 * The one obvious start, like UnleashX's Add Tool modal: pick the app by name.
 * Apps we don't list yet: paste a link to their API docs instead.
 */
/** Tiles shown before "Show all": three rows on a wide screen. Search always covers every app. */
const FIRST_TILES = 9;

export function StartBox() {
  const [state, action, pending] = useActionState<StartState, FormData>(startFromLink, {});
  const [which, setWhich] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const apps = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? CATALOG.filter((a) => `${a.name} ${a.category} ${a.blurb}`.toLowerCase().includes(q)) : CATALOG;
  }, [query]);
  const shown = query.trim() || showAll ? apps : apps.slice(0, FIRST_TILES);

  return (
    <div className="flex w-full flex-col gap-4">
      <section aria-labelledby="pick-app" className="window p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="pick-app" className="text-[1.0625rem] font-semibold">
            Which app should your AI employee use?
          </h2>
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Search apps</span>
            <IconSearch size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search apps"
              className="field w-full pl-9"
            />
          </label>
        </div>

        {apps.length > 0 ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Apps">
            {shown.map((a) => (
              <li key={a.key}>
                <form action={action} onSubmit={() => setWhich(a.key)} className="h-full">
                  <input type="hidden" name="app" value={a.key} />
                  <button
                    type="submit"
                    disabled={pending}
                    className="flex h-full w-full items-start gap-3 rounded-[var(--radius)] border border-[var(--separator)] bg-[var(--surface)] p-3 text-left transition-colors hover:border-[var(--signal)] hover:bg-[var(--signal-tint)] disabled:opacity-60"
                  >
                    <Monogram name={a.name} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-ink">{pending && which === a.key ? "Starting…" : a.name}</span>
                        {a.sample ? <Tag tone="green">No account</Tag> : <Tag tone="grey">{a.category}</Tag>}
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-soft">{a.blurb}</span>
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm text-ink-soft">
              No app called &quot;{query}&quot; yet. Paste a link to its API docs below and we&apos;ll read them.
            </p>
            <RequestApp key={query} initialName={query} />
          </div>
        )}
        {shown.length < apps.length && (
          <div className="mt-3 flex justify-center">
            <button type="button" className="btn btn-sm" onClick={() => setShowAll(true)}>
              Show all {apps.length} apps
            </button>
          </div>
        )}
        {apps.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-ink-soft">Don&apos;t see your app?</summary>
            <div className="mt-2">
              <RequestApp />
            </div>
          </details>
        )}
      </section>

      <form
        action={action}
        onSubmit={() => setWhich("url")}
        className="w-full rounded-[14px] border border-[color-mix(in_srgb,var(--signal)_45%,transparent)] bg-[var(--surface)] p-3 shadow-[0_0_0_4px_color-mix(in_srgb,var(--signal)_8%,transparent)] focus-within:border-[var(--signal)]"
      >
        <label htmlFor="start-url" className="mb-1 block px-1 text-sm font-semibold">
          Don&apos;t see your app? Paste a link to its API docs
        </label>
        <div className="flex items-start gap-2">
          <IconLink className="mt-2.5 ml-1 shrink-0 text-ink-soft" />
          <textarea
            id="start-url"
            name="url"
            rows={2}
            defaultValue={state.url}
            placeholder="Paste a link to the app's API docs or OpenAPI file"
            className="min-h-14 w-full resize-none bg-transparent px-1 py-2 text-[1.0625rem] outline-none placeholder:text-ink-soft"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" className="btn btn-primary mt-1 shrink-0" disabled={pending} aria-label="Start">
            {pending && which === "url" ? "Reading…" : (
              <>
                Start <IconArrowRight size={16} />
              </>
            )}
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--separator)] px-1 pt-2 text-sm text-ink-soft">
          <span>Tip: search the web for &quot;[app name] API reference&quot;.</span>
          <Link href="/apps/new?source=openapi" className="inline-flex items-center gap-1">
            <IconDoc size={15} /> Upload a file
          </Link>
          <Link href="/apps/new?source=text" className="inline-flex items-center gap-1">
            <IconDoc size={15} /> Paste docs text
          </Link>
        </div>
      </form>

      {state.error && (
        <p role="alert" className="rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--alarm)_35%,transparent)] bg-[var(--alarm-tint)] px-3 py-2 text-sm">
          {state.error}
        </p>
      )}
      {pending && (
        <p className="text-sm text-ink-soft" role="status">
          Reading the docs. Big APIs take up to 20 seconds…
        </p>
      )}
    </div>
  );
}
