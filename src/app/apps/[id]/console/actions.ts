"use server";

import { z } from "zod";
import { ownedConnector, requireSession } from "@/server/auth/guard";
import { mcpUrl } from "@/server/origin";
import { mintConsoleToken } from "@/server/publish/tokens";
import { talkToApp, type TalkResult } from "@/server/chat/talk";

export type ConsoleOp =
  | { method: "server/discover" }
  | { method: "tools/list" }
  | { method: "tools/call"; name: string; arguments: Record<string, unknown> };

export type Exchange = {
  request: { method: "POST"; url: string; headers: Record<string, string>; body: unknown };
  response: { status: number; headers: Record<string, string>; body: unknown } | null;
  error?: string;
  durationMs: number;
};

const PROTOCOL = "2026-07-28";
let seq = 0;

/**
 * The test console is a real MCP client: it POSTs JSON-RPC over HTTP to this
 * app's own public endpoint, with a 10-minute console token, and returns the
 * raw exchange (token hidden) for display.
 */
export async function consoleRequestAction(connectorId: string, op: ConsoleOp): Promise<Exchange> {
  await requireSession();
  if (!z.uuid().safeParse(connectorId).success || !(await ownedConnector(connectorId))) throw new Error("Unknown app");
  const params: Record<string, unknown> =
    op.method === "tools/call" ? { name: String(op.name).slice(0, 128), arguments: op.arguments ?? {} } : {};
  params._meta = {
    "io.modelcontextprotocol/protocolVersion": PROTOCOL,
    "io.modelcontextprotocol/clientInfo": { name: "byomcp-test-console", version: "1.0.0" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const body = { jsonrpc: "2.0", id: ++seq, method: op.method, params };
  const token = mintConsoleToken(connectorId);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL,
    "mcp-method": op.method,
    ...(op.method === "tools/call" ? { "mcp-name": String(op.name).slice(0, 128) } : {}),
  };
  const url = mcpUrl(connectorId);
  const shownHeaders = { ...headers, authorization: "Bearer byoc.… (10-minute console token, hidden)" };

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    const text = await res.text();
    const type = res.headers.get("content-type") ?? "";
    let parsed: unknown = text;
    try {
      if (type.includes("text/event-stream")) {
        const data = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter(Boolean);
        parsed = data.length === 1 ? JSON.parse(data[0]) : data.map((d) => JSON.parse(d));
      } else if (text) {
        parsed = JSON.parse(text);
      }
    } catch {
      parsed = text.slice(0, 20_000);
    }
    const keep = ["content-type", "www-authenticate", "mcp-protocol-version"];
    const respHeaders = Object.fromEntries([...res.headers.entries()].filter(([k]) => keep.includes(k)));
    return {
      request: { method: "POST", url, headers: shownHeaders, body },
      response: { status: res.status, headers: respHeaders, body: parsed },
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      request: { method: "POST", url, headers: shownHeaders, body },
      response: null,
      error: err instanceof Error ? err.message : "Request failed",
      durationMs: Date.now() - started,
    };
  }
}

/** "Talk to it": one chat message, answered by an AI employee using this app's published tools. */
export async function talkAction(connectorId: string, messages: { role: "user" | "assistant"; text: string }[], consented: boolean): Promise<TalkResult> {
  const ws = await requireSession();
  const connector = await ownedConnector(connectorId);
  if (!connector) return { ok: false, error: "This app wasn't found." };
  if (consented !== true) return { ok: false, error: "Confirm you understand what the test chat sends to the AI first." };
  const clean = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
    .slice(-10)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 2000) }));
  if (clean.length === 0 || clean[clean.length - 1].role !== "user" || !clean[clean.length - 1].text.trim()) {
    return { ok: false, error: "Type a request first." };
  }
  return talkToApp({ workspace: ws, connectorId, appName: connector.name, messages: clean });
}
