"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="passcode" className="font-semibold">
        Workspace passcode
      </label>
      <input
        id="passcode"
        name="passcode"
        type="password"
        autoComplete="current-password"
        required
        aria-invalid={!!state.error}
        aria-describedby={state.error ? "passcode-error" : undefined}
        className="field"
      />
      {state.error && (
        <p id="passcode-error" role="alert" className="text-alarm">
          ⚠ {state.error}
        </p>
      )}
      <div className="pt-1">
        <button type="submit" disabled={pending} className="btn btn-primary w-full">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
