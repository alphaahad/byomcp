"use client";

import { useState } from "react";

/** A read-only typed value with a copy button. */
export function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const id = `copy-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="flex gap-2">
        <input id={id} readOnly value={value} className="field text-sm" onFocus={(e) => e.currentTarget.select()} spellCheck={false} />
        <button
          type="button"
          className="btn btn-sm shrink-0"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {secret && <p className="text-xs text-ink-soft">Shown once. We only keep a fingerprint of it, so copy it now.</p>}
    </div>
  );
}
