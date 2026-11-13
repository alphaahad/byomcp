"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { ResultView } from "@/components/result-view";
import { AiTag, formatUsd } from "@/components/ui";
import type { ChatStep } from "@/server/llm/types";
import { talkAction } from "./actions";

type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; steps: ChatStep[]; cost: number | null; left: number | null; stoppedEarly: boolean }
  | { role: "error"; text: string };

const CONSENT_KEY = "byomcp:talk-consent";
const listeners = new Set<() => void>();
const readConsent = () => {
  try {
    return localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const waiting = (s: ChatStep) => /^Waiting for approval/.test(s.result);

/** "Talk to it": ask in plain words and watch an AI employee use this app's tools. */
export function TalkClient({ connectorId, appName }: { connectorId: string; appName: string }) {
  const router = useRouter();
  const consented = useSyncExternalStore(subscribe, readConsent, () => false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  const consent = () => {
    try {
      localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      /* ignore: they'll be asked again next time */
    }
    listeners.forEach((fn) => fn());
  };

  const ask = (text: string) => {
    const q = text.trim();
    if (!q || pending) return;
    const history = turns.flatMap((t) => (t.role === "error" ? [] : [{ role: t.role, text: t.text }]));
    setTurns((ts) => [...ts, { role: "user", text: q }]);
    setDraft("");
    start(async () => {
      const r = await talkAction(connectorId, [...history, { role: "user", text: q }], true);
      setTurns((ts) => [
        ...ts,
        r.ok
          ? { role: "assistant", text: r.answer, steps: r.steps, cost: r.costUsd, left: r.left, stoppedEarly: r.stoppedEarly }
          : { role: "error", text: r.error },
      ]);
      router.refresh(); // Setup, Activity, Approvals badge
      setTimeout(() => endRef.current?.scrollIntoView({ block: "nearest" }), 50);
    });
  };

  return (
    <section className="window flex flex-col gap-4 p-5" aria-labelledby="talk-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="talk-title" className="text-[1.0625rem] font-semibold">
          Talk to it
        </h2>
        <AiTag used note="for testing only" />
      </div>
      <p className="text-sm text-ink-soft">
        Ask in plain words, the way you&apos;d ask your AI employee. You&apos;ll see which tools it picks, what it sends, and what {appName} sends back.
        Anything that changes data still waits for your approval.
      </p>

      {!consented ? (
        <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-[var(--bg)] p-4 text-sm">
          <p className="font-semibold">Before you start: this test sends data to an AI</p>
          <ul className="list-disc pl-5 text-ink-soft">
            <li>What you type, and what {appName} sends back to the tools (like tickets or employee details), go to Google&apos;s AI to write the answer.</li>
            <li>On Google&apos;s free tier, Google may use that data to improve its products. Use test data, not real customer data.</li>
            <li>Your keys are never sent. Your AI employee in UnleashX doesn&apos;t use our AI at all: this is only for testing here.</li>
          </ul>
          <div>
            <button type="button" className="btn btn-primary btn-sm" onClick={consent}>
              I understand, start the test chat
            </button>
          </div>
        </div>
      ) : (
        <>
          {turns.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {["What can you do?", `Show me the latest few records in ${appName}`].map((s) => (
                <button key={s} type="button" className="chip" onClick={() => ask(s)} disabled={pending}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <ol className="flex flex-col gap-3" aria-live="polite">
            {turns.map((t, i) => (
              <li key={i} className={t.role === "user" ? "self-end max-w-[85%]" : "max-w-full"}>
                {t.role === "user" ? (
                  <p className="rounded-[var(--radius)] bg-[var(--signal-tint)] px-3 py-2 text-sm">{t.text}</p>
                ) : t.role === "error" ? (
                  <p role="alert" className="rounded-[var(--radius)] border border-[color-mix(in_srgb,var(--alarm)_35%,transparent)] bg-[var(--alarm-tint)] px-3 py-2 text-sm">
                    {t.text}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {t.steps.map((s, j) => (
                      <details key={j} className="rounded-[var(--radius-sm)] border border-[var(--separator)] p-2 text-sm">
                        <summary className="cursor-pointer">
                          <span className={s.isError ? "text-alarm" : waiting(s) ? "text-warn" : "text-ok"}>
                            {s.isError ? "⚠" : waiting(s) ? "⏳" : "✓"}
                          </span>{" "}
                          Used <span className="font-mono">{s.tool}</span>
                          {waiting(s) ? ": waiting for approval" : s.isError ? ": didn't work" : ""}
                        </summary>
                        <div className="mt-2 flex flex-col gap-2">
                          <p className="text-xs text-ink-soft">
                            Sent: <span className="font-mono break-all">{JSON.stringify(s.args)}</span>
                          </p>
                          {waiting(s) ? (
                            <p>
                              Nothing was sent to {appName} yet. <Link href="/approvals">Review it in Approvals</Link>.
                            </p>
                          ) : s.isError ? (
                            <p>{s.result}</p>
                          ) : (
                            <ResultView data={s.result} />
                          )}
                        </div>
                      </details>
                    ))}
                    <p className="rounded-[var(--radius)] border border-[var(--separator)] bg-[var(--surface)] px-3 py-2 text-sm whitespace-pre-wrap">{t.text}</p>
                    <p className="text-xs text-ink-soft">
                      {t.steps.length} tool call{t.steps.length === 1 ? "" : "s"}
                      {t.cost !== null ? ` · est. ${formatUsd(t.cost)}` : ""}
                      {t.left !== null ? ` · ${t.left} test message${t.left === 1 ? "" : "s"} left today` : ""}
                      {t.stoppedEarly ? " · stopped at the step limit" : ""}
                    </p>
                  </div>
                )}
              </li>
            ))}
            {pending && <li className="text-sm text-ink-soft">Thinking and using {appName}&apos;s tools…</li>}
          </ol>
          <div ref={endRef} />

          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <label htmlFor="talk-input" className="sr-only">
              Your request
            </label>
            <textarea
              id="talk-input"
              rows={2}
              value={draft}
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(draft);
                }
              }}
              placeholder={`Ask something, e.g. "find open tickets about refunds"`}
              className="field w-full resize-none"
            />
            <button type="submit" className="btn btn-primary" disabled={pending || !draft.trim()}>
              {pending ? "Working…" : "Send"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
