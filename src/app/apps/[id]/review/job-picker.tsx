"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { applyJobsAction } from "./actions";

export type JobOption = { key: string; title: string; description: string; matched: number; writes: number; on: boolean };

/** "What should your AI employee do?": catalog jobs instead of a list of endpoints. */
export function JobPicker({ appName, versionId, jobs, editable }: { appName: string; versionId: string; jobs: JobOption[]; editable: boolean }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(jobs.filter((j) => j.on).map((j) => j.key)));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const usable = jobs.filter((j) => j.matched > 0);
  if (usable.length === 0) return null;

  const toggle = (key: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section aria-labelledby="jobs-title" className="window p-5">
      <h2 id="jobs-title" className="text-[1.125rem] font-semibold">
        What should your AI employee do in {appName}?
      </h2>
      <p className="mt-1 text-sm text-ink-soft">Pick one or more jobs and we&apos;ll turn on just the actions they need. You can fine-tune the list below.</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {usable.map((j) => {
          const checked = chosen.has(j.key);
          return (
            <li key={j.key}>
              <label
                className={`flex h-full cursor-pointer items-start gap-3 rounded-[var(--radius)] border p-3 ${checked ? "border-[var(--signal)] bg-[var(--signal-tint)]" : "border-[var(--separator)]"}`}
              >
                <input type="checkbox" className="chk mt-1" checked={checked} disabled={!editable || pending} onChange={() => toggle(j.key)} />
                <span>
                  <span className="block font-semibold">{j.title}</span>
                  <span className="block text-sm text-ink-soft">{j.description}</span>
                  <span className="mt-1 block text-xs text-ink-soft">
                    {j.matched} action{j.matched === 1 ? "" : "s"}
                    {j.writes > 0 ? ` · ${j.writes} change${j.writes === 1 ? "s" : ""} data and wait${j.writes === 1 ? "s" : ""} for your approval` : " · read only"}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!editable || pending || chosen.size === 0}
          onClick={() =>
            start(async () => {
              const r = await applyJobsAction(versionId, [...chosen]);
              setMessage(r.ok ? { ok: true, text: `Done: ${r.count} action${r.count === 1 ? " is" : "s are"} on, everything else is off.` } : { ok: false, text: r.error });
              router.refresh();
            })
          }
        >
          {pending ? "Turning on…" : "Turn these on"}
        </button>
        {!editable && <span className="text-sm text-ink-soft">This version is published. Start a new draft on the Publish tab to change it.</span>}
        {message && (
          <span role="status" className={`text-sm ${message.ok ? "text-ok" : "text-alarm"}`}>
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}
