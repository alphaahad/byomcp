/**
 * Turn an API response into something a non-technical person can read:
 * a list becomes a small table, a record becomes label/value pairs.
 * Pure (tested); the raw data is always available behind "Show raw data".
 */

export type Shaped =
  | { kind: "table"; total: number; columns: { key: string; label: string }[]; rows: string[][] }
  | { kind: "fields"; fields: { label: string; value: string }[] }
  | { kind: "text"; text: string }
  | { kind: "empty" };

const MAX_ROWS = 10;
const MAX_COLS = 5;
const MAX_FIELDS = 15;
const MAX_CELL = 120;

/** Columns people look for first. */
const PREFERRED = /^(name|full_?name|display_?name|title|subject|summary|first_?name|last_?name|email|status|state|priority|type|created_?at|updated_?at|date|amount|id)$/i;

const isScalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

/** "created_at" -> "Created at", "firstName" -> "First name". */
export function humanLabel(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : key;
}

function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return Array.isArray(v) ? `${v.length} item${v.length === 1 ? "" : "s"}` : "…";
  const s = String(v);
  return s.length > MAX_CELL ? `${s.slice(0, MAX_CELL - 1)}…` : s;
}

/** Parse JSON from a string, also when a sentence comes before it ("It worked.\n\n{...}"). */
export function parseLoose(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const t = value.trim();
  if (!t) return "";
  try {
    return JSON.parse(t);
  } catch {
    const start = t.search(/[[{]/);
    if (start > 0) {
      try {
        return JSON.parse(t.slice(start));
      } catch {
        /* fall through */
      }
    }
    return value;
  }
}

/**
 * The list a response is about: a bare array, or a wrapper like
 * { tickets: [...], count: 2 }. A record that has its own id/name/title is a
 * record, even if it holds arrays (a pet's tags), and an empty array only
 * counts as "the list" in a small wrapper ({ data: [], count: 0 }).
 */
function findList(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (["id", "name", "title"].some((k) => isScalar(obj[k]) && obj[k] !== null)) return null;
  const arrays = Object.values(obj).filter(Array.isArray);
  const ofObjects = arrays.find((v) => v.length > 0 && typeof v[0] === "object" && v[0] !== null);
  if (ofObjects) return ofObjects;
  const empty = arrays.find((v) => v.length === 0);
  return empty && Object.keys(obj).length <= 3 ? empty : null;
}

export function shapeResult(input: unknown): Shaped {
  const data = parseLoose(input);
  if (data === null || data === undefined || data === "") return { kind: "empty" };
  if (typeof data === "string") return { kind: "text", text: data.length > 2000 ? `${data.slice(0, 2000)}…` : data };
  if (!Array.isArray(data) && typeof data !== "object") return { kind: "text", text: String(data) };

  const list = findList(data);
  if (list) {
    if (list.length === 0) return { kind: "table", total: 0, columns: [], rows: [] };
    if (list.every(isScalar)) return { kind: "table", total: list.length, columns: [{ key: "value", label: "Value" }], rows: list.slice(0, MAX_ROWS).map((v) => [cell(v)]) };
    const sample = list.slice(0, MAX_ROWS).filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r));
    const keys = [...new Set(sample.flatMap((r) => Object.keys(r).filter((k) => isScalar(r[k]))))];
    const preferred = keys.filter((k) => PREFERRED.test(k)).sort((a, b) => keys.indexOf(a) - keys.indexOf(b));
    const rest = keys.filter((k) => !PREFERRED.test(k));
    const columns = [...preferred, ...rest].slice(0, MAX_COLS).map((key) => ({ key, label: humanLabel(key) }));
    return { kind: "table", total: list.length, columns, rows: sample.map((r) => columns.map((c) => cell(r[c.key]))) };
  }

  const fields = Object.entries(data as Record<string, unknown>)
    .filter(([, v]) => isScalar(v) || (Array.isArray(v) && v.every(isScalar)))
    .slice(0, MAX_FIELDS)
    .map(([k, v]) => ({ label: humanLabel(k), value: Array.isArray(v) ? v.map(cell).join(", ") || "—" : cell(v) }));
  return fields.length ? { kind: "fields", fields } : { kind: "text", text: JSON.stringify(data).slice(0, 2000) };
}
