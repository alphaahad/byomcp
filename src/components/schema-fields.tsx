"use client";

import { humanLabel } from "@/lib/result-shape";

/**
 * Form fields for a tool's flat input schema (the same shape MCP clients see),
 * so nobody has to write JSON. Used by Try it and the Test console.
 */
export type FieldSchema = {
  properties?: Record<string, FieldProp>;
  required?: string[];
};
export type FieldProp = { type?: string | string[]; description?: string; enum?: unknown[]; default?: unknown };

export function fieldType(p: FieldProp): string {
  const t = Array.isArray(p.type) ? p.type.find((x) => x !== "null") : p.type;
  return t ?? "string";
}

function coerce(raw: FormDataEntryValue | null, p: FieldProp, isCheckbox: boolean): unknown {
  if (isCheckbox) return raw === "on";
  const s = String(raw ?? "").trim();
  if (s === "") return undefined;
  switch (fieldType(p)) {
    case "integer":
    case "number": {
      const n = Number(s);
      return Number.isFinite(n) ? n : s; // let validation explain a bad number
    }
    case "array":
      if (s.startsWith("[")) {
        try {
          return JSON.parse(s);
        } catch {
          return s;
        }
      }
      return s.split(",").map((x) => x.trim()).filter(Boolean);
    case "object":
      try {
        return JSON.parse(s);
      } catch {
        return s;
      }
    default:
      return s;
  }
}

/** Read the inputs back from the form, typed. Unticked optional checkboxes are left out. */
export function readSchemaForm(form: HTMLFormElement, schema: FieldSchema): Record<string, unknown> {
  const f = new FormData(form);
  const required = new Set(schema.required ?? []);
  const input: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(schema.properties ?? {})) {
    const isBool = fieldType(p) === "boolean";
    const v = coerce(f.get(name), p, isBool);
    if (v !== undefined && !(isBool && v === false && !required.has(name))) input[name] = v;
  }
  return input;
}

export function SchemaFields({ schema, idPrefix }: { schema: FieldSchema; idPrefix: string }) {
  const props = Object.entries(schema.properties ?? {});
  const required = new Set(schema.required ?? []);
  if (props.length === 0) return <p className="text-sm">This action has no inputs.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {props.map(([name, p]) => {
        const t = fieldType(p);
        const id = `${idPrefix}-${name}`;
        const descId = p.description ? `${id}-desc` : undefined;
        return (
          <div key={name} className="flex flex-col gap-1">
            <label htmlFor={id} className="text-sm font-semibold">
              {humanLabel(name)}
              {required.has(name) ? " (required)" : ""} <span className="font-mono text-xs font-normal text-ink-soft">{name}</span>
            </label>
            {t === "boolean" ? (
              <input id={id} name={name} type="checkbox" className="chk" aria-describedby={descId} />
            ) : Array.isArray(p.enum) && p.enum.length > 0 && p.enum.length <= 30 ? (
              <select
                id={id}
                name={name}
                className="field"
                aria-describedby={descId}
                defaultValue={p.default !== undefined ? String(p.default) : required.has(name) ? String(p.enum[0]) : ""}
              >
                <option value="">{required.has(name) ? "Choose…" : "(not set)"}</option>
                {p.enum.map((v) => (
                  <option key={String(v)} value={String(v)}>
                    {String(v)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                name={name}
                className="field font-mono text-sm"
                aria-describedby={descId}
                defaultValue={p.default !== undefined && typeof p.default !== "object" ? String(p.default) : undefined}
                inputMode={t === "integer" || t === "number" ? "numeric" : undefined}
                placeholder={t === "array" ? "a, b, c" : t === "object" ? '{"key": "value"}' : ""}
                required={required.has(name)}
              />
            )}
            {p.description && (
              <span id={descId} className="text-xs text-ink-soft">
                {p.description.slice(0, 200)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
