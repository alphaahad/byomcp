/**
 * How many records a response holds, for plain-language results
 * ("we read 25 tickets"). Handles a bare array, or an object whose first
 * array property holds the records ({ tickets: [...] }, { data: [...] }).
 * Returns null when there's no clear list.
 */
export function countRecords(data: unknown): { count: number; noun: string | null } | null {
  let value = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) return { count: value.length, noun: null };
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (Array.isArray(v)) return { count: v.length, noun: /^(data|items|results|records|list|values)$/i.test(key) ? null : key.replace(/_/g, " ") };
    }
  }
  return null;
}

/** "25 tickets", "1 record", "no records". */
export function describeCount(r: { count: number; noun: string | null }): string {
  const noun = r.noun ?? "record";
  const singular = noun.endsWith("ies") ? `${noun.slice(0, -3)}y` : noun.endsWith("s") ? noun.slice(0, -1) : noun;
  const plural = r.noun ?? "records";
  if (r.count === 0) return `no ${plural}`;
  return `${r.count} ${r.count === 1 ? singular : plural.endsWith("s") ? plural : `${plural}s`}`;
}
