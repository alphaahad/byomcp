"use client";

import { useActionState } from "react";
import { setNotifyEmailAction, type NotifyState } from "./actions";

/** "Email me when a request is waiting". */
export function NotifyForm({ current, available }: { current: string | null; available: boolean }) {
  const [state, action, pending] = useActionState<NotifyState, FormData>(setNotifyEmailAction, { email: current });
  const email = state.ok && !state.pending ? (state.email ?? null) : current;

  return (
    <section aria-labelledby="notify-title" className="window flex flex-col gap-2 p-4 text-sm">
      <h2 id="notify-title" className="font-semibold">
        Email me when a request is waiting
      </h2>
      {!available ? (
        <p className="text-ink-soft">Email alerts aren&apos;t set up on this BYOMCP yet (the owner adds an email service). Check this page, or watch the bell at the top.</p>
      ) : state.pending ? (
        <p role="status">
          Check <strong>{state.pending}</strong> for a confirmation email. Alerts start once you open its link (while signed in here).
        </p>
      ) : email ? (
        <form action={action} className="flex flex-wrap items-center gap-3">
          <span>
            On: we email <strong>{email}</strong> when your AI employee asks to change something (at most one email every 10 minutes).
          </span>
          <input type="hidden" name="off" value="1" />
          <button type="submit" className="btn btn-sm" disabled={pending}>
            Turn off
          </button>
        </form>
      ) : (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-ink-soft">Your email</span>
            <input name="email" type="email" required autoComplete="email" placeholder="you@company.com" className="field w-64" />
          </label>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
            {pending ? "Saving…" : "Turn on"}
          </button>
          <span className="basis-full text-xs text-ink-soft">We&apos;ll send a link to confirm it&apos;s your address. Alerts say what&apos;s waiting and link here, never the data being sent.</span>
        </form>
      )}
      {state.error && (
        <p role="alert" className="text-alarm">
          {state.error}
        </p>
      )}
    </section>
  );
}
