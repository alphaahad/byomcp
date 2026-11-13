"use client";

import { useActionState, useSyncExternalStore } from "react";
import { startFromLink, type StartState } from "./start-actions";

const KEY = "byomcp:welcome-dismissed";
const listeners = new Set<() => void>();
const readHidden = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false; // storage blocked: just show it
  }
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** First visit to an empty workspace: what you'll need, and the two ways to start. */
export function Welcome() {
  const hidden = useSyncExternalStore(subscribe, readHidden, () => false);
  const [state, action, starting] = useActionState<StartState, FormData>(startFromLink, {});

  if (hidden) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    listeners.forEach((fn) => fn());
  };

  return (
    <section aria-labelledby="welcome-title" className="window w-full max-w-5xl p-5 text-left">
      <div className="flex items-start justify-between gap-3">
        <h2 id="welcome-title" className="text-[1.125rem] font-semibold">
          Welcome. Here&apos;s what you&apos;ll need
        </h2>
        <button type="button" onClick={dismiss} className="text-sm text-ink-soft underline">
          Hide
        </button>
      </div>
      <ul className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <li className="rounded-[var(--radius-sm)] bg-[var(--bg)] p-3">
          <span className="block font-semibold">The app&apos;s name</span>
          <span className="text-ink-soft">Pick it from the list below. Not there? A link to its API docs works too.</span>
        </li>
        <li className="rounded-[var(--radius-sm)] bg-[var(--bg)] p-3">
          <span className="block font-semibold">An admin login to that app</span>
          <span className="text-ink-soft">To create a key. No access? We&apos;ll give you a message to send your admin.</span>
        </li>
        <li className="rounded-[var(--radius-sm)] bg-[var(--bg)] p-3">
          <span className="block font-semibold">About 5 minutes</span>
          <span className="text-ink-soft">Pick the app, choose what it may do, connect, publish. No code.</span>
        </li>
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a href="#pick-app" className="btn btn-primary">
          Pick your app
        </a>
        <form action={action}>
          <input type="hidden" name="app" value="petstore" />
          <button type="submit" className="btn" disabled={starting}>
            {starting ? "Starting…" : "Try the sample first (2 minutes, no account)"}
          </button>
        </form>
      </div>
      {state.error && (
        <p role="alert" className="mt-2 text-sm text-alarm">
          {state.error}
        </p>
      )}
    </section>
  );
}
