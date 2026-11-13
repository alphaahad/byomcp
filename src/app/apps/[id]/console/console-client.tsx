"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ResultView } from "@/components/result-view";
import { SchemaFields, readSchemaForm, type FieldSchema } from "@/components/schema-fields";
import { consoleRequestAction, type ConsoleOp, type Exchange } from "./actions";

type Tool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: FieldSchema & { type?: string };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

type CallOutcome = { tool: Tool; text: string; isError: boolean; waiting: boolean; http: number | null; failed: string | null };

function resultOf(ex: Exchange): Record<string, unknown> | null {
  const b = ex.response?.body;
  const one = Array.isArray(b) ? b[b.length - 1] : b;
  return one && typeof one === "object" ? (one as Record<string, unknown>) : null;
}

const kind = (t: Tool) => (t.annotations?.destructiveHint ? "Destructive" : t.annotations?.readOnlyHint ? "Read" : "Changes data");

/** The console: what your AI employee sees, used through a form. Every request is a real MCP call. */
export function ConsoleClient({ connectorId, endpoint }: { connectorId: string; endpoint: string }) {
  const router = useRouter();
  const [log, setLog] = useState<(Exchange & { label: string })[]>([]);
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [selected, setSelected] = useState("");
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonArgs, setJsonArgs] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const loaded = useRef(false);

  const send = (label: string, op: ConsoleOp, then?: (ex: Exchange) => void) =>
    start(async () => {
      const ex = await consoleRequestAction(connectorId, op);
      setLog((l) => [{ ...ex, label }, ...l].slice(0, 20));
      then?.(ex);
    });

  const listTools = () =>
    send("List tools", { method: "tools/list" }, (ex) => {
      const r = resultOf(ex)?.result as { tools?: Tool[] } | undefined;
      if (!r?.tools) {
        setError(ex.response ? `Listing tools failed (HTTP ${ex.response.status}). Is the app published?` : (ex.error ?? "Couldn't reach the MCP address."));
        return;
      }
      setError(null);
      setTools(r.tools);
      setSelected((s) => s || r.tools![0]?.name || "");
    });

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    listTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tool = tools?.find((t) => t.name === selected);

  const call = (args: Record<string, unknown>) => {
    if (!tool) return;
    send(`Call ${tool.name}`, { method: "tools/call", name: tool.name, arguments: args }, (ex) => {
      const res = resultOf(ex);
      const r = res?.result as { content?: { type: string; text?: string }[]; isError?: boolean } | undefined;
      const text = (r?.content ?? []).map((c) => c.text ?? "").join("\n");
      const rpcError = (res?.error as { message?: string } | undefined)?.message ?? null;
      setOutcome({
        tool,
        text,
        isError: !!r?.isError || !!rpcError || !ex.response,
        waiting: /^Waiting for approval/.test(text),
        http: ex.response?.status ?? null,
        failed: rpcError ?? (ex.response ? null : (ex.error ?? "No response")),
      });
      router.refresh(); // Setup panel: "Used by an AI employee"
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-soft">
        See your app the way your AI employee does. Pick one of its tools, fill in the form and run it. Each run is a real call to your MCP
        address with a 10-minute test token. Anything that changes data waits for approval, exactly as it would for your AI employee.
      </p>

      {error && (
        <p role="alert" className="rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--alarm)_35%,transparent)] bg-[var(--alarm-tint)] px-3 py-2 text-sm">
          {error}{" "}
          <button type="button" className="underline" onClick={listTools}>
            Try again
          </button>
        </p>
      )}

      <section className="flex flex-col gap-4" aria-labelledby="run-title">
        <h2 id="run-title" className="sr-only">
          Run a tool
        </h2>
        {tools === null ? (
          <p className="text-sm text-ink-soft">{pending ? "Loading your AI employee's tools…" : "No tools loaded yet."}</p>
        ) : tools.length === 0 ? (
          <p className="text-sm">No tools are published. Turn on actions on the Actions tab, then publish.</p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!tool) return;
              if (jsonMode) {
                try {
                  const parsed = JSON.parse(jsonArgs);
                  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
                  setError(null);
                  call(parsed);
                } catch {
                  setError("The JSON isn't a valid object, like {\"status\": \"open\"}.");
                }
                return;
              }
              call(readSchemaForm(e.currentTarget, tool.inputSchema ?? {}));
            }}
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="tool" className="text-sm font-semibold">
                Tool
              </label>
              <select
                id="tool"
                className="field max-w-xl"
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setOutcome(null);
                }}
              >
                {tools.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.title ?? t.name} ({kind(t)})
                  </option>
                ))}
              </select>
              {tool?.description && <p className="text-xs text-ink-soft">{tool.description.slice(0, 300)}</p>}
            </div>

            {tool &&
              (jsonMode ? (
                <div className="flex flex-col gap-1">
                  <label htmlFor="args" className="text-sm font-semibold">
                    Arguments (JSON)
                  </label>
                  <textarea id="args" className="field font-mono text-xs" rows={6} value={jsonArgs} onChange={(e) => setJsonArgs(e.target.value)} spellCheck={false} />
                </div>
              ) : (
                <SchemaFields key={tool.name} schema={tool.inputSchema ?? {}} idPrefix={`console-${tool.name}`} />
              ))}

            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !tool}>
                {pending ? "Running…" : "Run it"}
              </button>
              <button type="button" className="text-sm text-ink-soft underline" onClick={() => setJsonMode((m) => !m)}>
                {jsonMode ? "Use the form" : "Send JSON instead"}
              </button>
            </div>
          </form>
        )}

        {outcome && (
          <div className="flex flex-col gap-2 border-t border-[var(--separator)] pt-4" aria-live="polite">
            {outcome.waiting ? (
              <>
                <p className="font-semibold text-warn">⏳ Waiting for approval</p>
                <p className="text-sm">
                  Nothing has been sent to the app yet. A person approves it in{" "}
                  <Link href="/approvals">Approvals</Link>, and then it runs exactly once.
                </p>
                <p className="text-xs text-ink-soft">{outcome.text}</p>
              </>
            ) : outcome.isError ? (
              <>
                <p className="font-semibold text-alarm">⚠ It didn&apos;t work</p>
                <p className="text-sm">{outcome.failed ?? outcome.text}</p>
              </>
            ) : (
              <>
                <p className="font-semibold text-ok">✓ It worked: this is what your AI employee gets back</p>
                <ResultView data={outcome.text} />
              </>
            )}
          </div>
        )}
      </section>

      <details className="window p-4 text-sm">
        <summary className="cursor-pointer font-medium">For engineers: raw MCP messages</summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-ink-soft">
            Address: <span className="font-mono break-all">{endpoint}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => send("Discover the server", { method: "server/discover" })}>
              Discover the server
            </button>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={listTools}>
              List tools again
            </button>
          </div>
          {log.length === 0 && <p>Nothing sent yet.</p>}
          <ol className="flex flex-col gap-3">
            {log.map((ex, i) => {
              const res = resultOf(ex);
              const isError = !!res?.error || (res?.result as { isError?: boolean } | undefined)?.isError;
              return (
                <li key={log.length - i} className="bevel-in p-3 text-xs">
                  <p className="mb-2 text-sm font-semibold">
                    {ex.label} · {ex.response ? `HTTP ${ex.response.status}` : "no response"} · {ex.durationMs} ms
                    {isError ? <span className="text-alarm"> · error</span> : ex.response?.status === 200 ? <span className="text-ok"> · ok</span> : null}
                  </p>
                  <details>
                    <summary className="cursor-pointer">Request</summary>
                    <pre className="mt-1 overflow-x-auto font-mono whitespace-pre-wrap">
                      {`POST ${ex.request.url}\n${Object.entries(ex.request.headers).map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${JSON.stringify(ex.request.body, null, 2)}`}
                    </pre>
                  </details>
                  <details>
                    <summary className="cursor-pointer">Response</summary>
                    <pre className="mt-1 max-h-96 overflow-auto font-mono whitespace-pre-wrap">
                      {ex.response
                        ? `HTTP ${ex.response.status}\n${Object.entries(ex.response.headers).map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${typeof ex.response.body === "string" ? ex.response.body : JSON.stringify(ex.response.body, null, 2)}`
                        : ex.error}
                    </pre>
                  </details>
                </li>
              );
            })}
          </ol>
        </div>
      </details>
    </div>
  );
}
