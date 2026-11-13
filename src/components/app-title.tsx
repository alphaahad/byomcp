"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { renameAppAction } from "@/app/apps/[id]/rename-action";

/** The app's name as the page title, with an inline Rename. */
export function AppTitle({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.select();
    else if (wasEditing.current) renameRef.current?.focus(); // return focus after Save or Cancel
    wasEditing.current = editing;
  }, [editing]);

  if (!editing) {
    return (
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="truncate text-[1.5rem] font-semibold tracking-tight">{name}</h1>
        <button ref={renameRef} type="button" className="shrink-0 text-sm text-signal hover:underline" onClick={() => setEditing(true)} aria-label={`Rename ${name}`}>
          Rename
        </button>
      </div>
    );
  }

  const cancel = () => {
    setError(null);
    setEditing(false);
  };

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const next = String(new FormData(e.currentTarget).get("name") ?? "");
        if (next.trim() === name) return cancel();
        start(async () => {
          const r = await renameAppAction(id, next);
          if (!r.ok) return setError(r.error);
          setError(null);
          setEditing(false);
          router.refresh(); // header, breadcrumb and sidebar
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="app-name" className="sr-only">
          App name
        </label>
        <input
          ref={inputRef}
          id="app-name"
          name="name"
          defaultValue={name}
          maxLength={60}
          required
          className="field max-w-sm text-[1.125rem] font-semibold"
          aria-invalid={!!error}
          aria-describedby={error ? "app-name-error" : "app-name-hint"}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn btn-sm" onClick={cancel} disabled={pending}>
          Cancel
        </button>
      </div>
      {error ? (
        <p id="app-name-error" role="alert" className="text-sm text-alarm">
          {error}
        </p>
      ) : (
        <p id="app-name-hint" className="text-sm text-ink-soft">
          Only the name changes. The MCP address stays the same, so connected AI employees keep working.
        </p>
      )}
    </form>
  );
}
