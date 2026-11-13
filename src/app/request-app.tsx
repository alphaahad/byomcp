"use client";

import { useActionState } from "react";
import { requestAppAction, type RequestState } from "./start-actions";

/** "Don't see your app? Tell us": tells us which apps to add to the catalog next. */
export function RequestApp({ initialName = "" }: { initialName?: string }) {
  const [state, action, pending] = useActionState<RequestState, FormData>(requestAppAction, {});
  if (state.ok) {
    return (
      <p role="status" className="text-sm text-ok">
        ✓ Thanks, noted. Meanwhile, a link to the app&apos;s API docs (below) works for most apps.
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2 text-sm">
      <p className="font-medium">Want it in this list? Tell us which app.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="sr-only">App name</span>
          <input name="appName" defaultValue={initialName} placeholder="App name, e.g. Freshdesk" maxLength={80} required className="field w-56" />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="sr-only">What should your AI employee do with it? (optional)</span>
          <input name="note" placeholder="What should your AI employee do with it? (optional)" maxLength={500} className="field" />
        </label>
        <button type="submit" className="btn btn-sm" disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-alarm">
          {state.error}
        </p>
      )}
    </form>
  );
}
