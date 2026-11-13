import Link from "next/link";
import type { SetupState } from "@/server/connectors/setup-state";
import { IconArrowRight, IconCheck } from "./icons";
import { ButtonLink } from "./ui";

/**
 * "Setup" card (like Leasha's Active plan): progress, a checklist where every
 * open item is a link, and always one obvious next step.
 */
export function SetupPanel({ state }: { state: SetupState }) {
  const total = state.steps.length;
  const pct = Math.round((state.doneCount / total) * 100);
  return (
    <section className="window p-4" aria-labelledby="setup-title">
      <div className="flex items-baseline justify-between">
        <h2 id="setup-title" className="text-[1.0625rem] font-semibold">
          Setup
        </h2>
        <span className="text-sm text-ink-soft">
          {state.doneCount} of {total}
          {state.next ? "" : " · done"}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--fill)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Setup progress">
        <div className="h-full rounded-full bg-[var(--ok)]" style={{ width: `${pct}%` }} />
      </div>
      <ol className="mt-3 flex flex-col gap-1">
        {state.steps.map((s, i) => {
          const isNext = state.next?.key === s.key;
          return (
            // Narrow screens show only the next step (with the progress bar); wide screens show all six.
            <li key={s.key} className={isNext ? "" : "hidden lg:block"}>
              <Link
                href={s.href}
                className={`flex items-start gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-ink no-underline hover:bg-[var(--fill)] hover:no-underline ${isNext ? "bg-[var(--signal-tint)]" : ""}`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                    s.done ? "border-[var(--ok)] bg-[var(--ok)] text-white" : isNext ? "border-[var(--signal)] text-signal" : "border-[var(--separator)] text-ink-soft"
                  }`}
                >
                  {s.done ? <IconCheck size={12} strokeWidth={3} /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={`block text-[0.9375rem] ${s.done ? "text-ink-soft line-through decoration-[var(--separator)]" : "font-medium"}`}>
                    {s.label}
                    <span className="sr-only">{s.done ? " (done)" : isNext ? " (next)" : ""}</span>
                  </span>
                  {isNext && <span className="block text-sm text-ink-soft">{s.hint}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      {state.next ? (
        <ButtonLink href={state.next.href} primary className="mt-3 w-full">
          Next: {state.next.cta} <IconArrowRight size={16} />
        </ButtonLink>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">All set. Your AI employee is using this app.</p>
      )}
    </section>
  );
}
