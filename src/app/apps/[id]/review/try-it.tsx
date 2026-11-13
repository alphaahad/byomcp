"use client";

import { useState, useTransition } from "react";
import { toolInputPlan } from "@/lib/tool-input";
import type { TryResult } from "@/server/runtime/try-action";
import { tryActionAction } from "./actions";
import { ResultView } from "@/components/result-view";
import { SchemaFields, readSchemaForm, type FieldSchema } from "@/components/schema-fields";
import type { ReviewAction } from "./review-list";

const STATUS_TEXT: Record<TryResult["status"], { glyph: string; text: string; ok: boolean }> = {
  success: { glyph: "✓✓", text: "It worked", ok: true },
  empty_or_invalid: { glyph: "?", text: "The app answered, but not with what we expected", ok: false },
  auth_failed: { glyph: "⚠", text: "The app rejected your key", ok: false },
  transient_failed: { glyph: "⚠", text: "The app didn't respond properly", ok: false },
  request_error: { glyph: "⚠", text: "The app said the request was wrong", ok: false },
  validation_error: { glyph: "⚠", text: "Check the inputs", ok: false },
};

export function TryIt({ action, onDone }: { action: ReviewAction; onDone: () => void }) {
  const plan = toolInputPlan(action.params);
  const schema = plan.schema as FieldSchema;
  const [pending, start] = useTransition();
  const [result, setResult] = useState<TryResult | { error: string } | null>(null);

  const run = (form: HTMLFormElement) => {
    const input = readSchemaForm(form, schema);
    start(async () => {
      const r = await tryActionAction(action.id, input);
      setResult(r);
      if (!("error" in r) && r.tested) onDone();
    });
  };

  return (
    <div className="bevel-in flex flex-col gap-3 p-3">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(e.currentTarget);
        }}
      >
        <p className="text-sm font-semibold">
          Try &quot;{action.title}&quot; for real, with your connected account. It only reads data.
        </p>
        <SchemaFields schema={schema} idPrefix={`try-${action.id}`} />
        <div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
            {pending ? "Running…" : "Run it"}
          </button>
        </div>
      </form>

      {result && "error" in result && (
        <p role="alert" className="text-sm">
          <span className="text-alarm">⚠ </span>
          {result.error}
        </p>
      )}
      {result && !("error" in result) && <TryResultView r={result} />}
    </div>
  );
}

function TryResultView({ r }: { r: TryResult }) {
  const s = STATUS_TEXT[r.status];
  const raw = typeof r.data === "string" ? r.data : JSON.stringify(r.data, null, 2);
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <p className={s.ok ? "font-bold text-ok" : "font-bold text-alarm"}>
        {s.glyph} {s.text}
        <span className="font-normal text-ink">
          {r.httpStatus ? ` · HTTP ${r.httpStatus}` : ""} · {r.durationMs} ms{r.attempts > 1 ? ` · ${r.attempts} attempts` : ""}
        </span>
      </p>
      {r.reason && <p className="text-sm">{r.reason}</p>}
      {r.tested && <p className="text-sm">This action is now marked Tested.</p>}
      {s.ok ? (
        <ResultView data={r.data} raw={raw} rawNote={r.truncated ? "shortened" : undefined} />
      ) : (
        raw &&
        raw !== "null" && (
          <details className="text-sm">
            <summary className="cursor-pointer">What the app sent back</summary>
            <pre className="bevel-in mt-1 max-h-80 overflow-auto p-2 font-mono text-xs whitespace-pre-wrap">{raw}</pre>
          </details>
        )
      )}
    </div>
  );
}
