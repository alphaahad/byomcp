import { shapeResult } from "@/lib/result-shape";

/**
 * An API response, readable: a table for lists, label/value pairs for a
 * record, plain text otherwise. The raw data sits behind "Show raw data".
 */
export function ResultView({ data, raw, rawNote }: { data: unknown; raw?: string; rawNote?: string }) {
  const shaped = shapeResult(data);
  const rawText = raw ?? (typeof data === "string" ? data : JSON.stringify(data, null, 2));

  return (
    <div className="flex flex-col gap-2 text-sm">
      {shaped.kind === "table" &&
        (shaped.total === 0 ? (
          <p className="text-ink-soft">Nothing found (an empty list).</p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--separator)]">
            <table className="w-full text-left">
              <caption className="px-3 py-1.5 text-left text-xs text-ink-soft">
                {shaped.total} {shaped.total === 1 ? "item" : "items"}
                {shaped.total > shaped.rows.length ? `, first ${shaped.rows.length} shown` : ""}
              </caption>
              <thead className="bg-[var(--fill)]">
                <tr>
                  {shaped.columns.map((c) => (
                    <th key={c.key} scope="col" className="px-3 py-1.5 font-semibold whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--separator)]">
                {shaped.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className="max-w-64 truncate px-3 py-1.5" title={v}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {shaped.kind === "fields" && (
        <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-1 rounded-[var(--radius-sm)] border border-[var(--separator)] p-3">
          {shaped.fields.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-ink-soft">{f.label}</dt>
              <dd className="min-w-0 break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {shaped.kind === "text" && <p className="whitespace-pre-wrap">{shaped.text}</p>}
      {shaped.kind === "empty" && <p className="text-ink-soft">No content came back.</p>}
      {rawText && rawText !== "null" && shaped.kind !== "text" && shaped.kind !== "empty" && (
        <details>
          <summary className="cursor-pointer text-ink-soft">Show raw data{rawNote ? ` (${rawNote})` : ""}</summary>
          <pre className="bevel-in mt-1 max-h-80 overflow-auto p-2 font-mono text-xs whitespace-pre-wrap">{rawText}</pre>
        </details>
      )}
    </div>
  );
}
