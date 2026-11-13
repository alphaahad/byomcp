import "server-only";
/**
 * The MCP server for one connector, built per request (stateless, MCP 2026-07-28,
 * with mcp-handler's fallback for 2025-era clients). Tools = the enabled actions
 * of the PUBLISHED version. Input schemas come straight from the database via
 * fromJsonSchema; the SDK validates arguments before our handler runs.
 */
import { fromJsonSchema, type CallToolResult } from "@modelcontextprotocol/server";
import { and, eq } from "drizzle-orm";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { toolAnnotations } from "@/lib/ir";
import { toolInputPlan } from "@/lib/tool-input";
import { db } from "@/server/db";
import { actions, connectors, workspaces } from "@/server/db/schema";
import { approvalStatusForConnector } from "@/server/approvals/approvals";
import { verifyEndpointToken } from "@/server/publish/tokens";
import { notifyApprovalWaiting } from "@/server/notify/email";
import { after } from "next/server";
import { runToolCall, type ConnectorForRuntime, type PublishedAction } from "@/server/runtime/tool-call";

const RESULT_MAX_CHARS = 20_000;
export const CHECK_TOOL = "check_approval";

export async function loadPublished(connectorId: string): Promise<{ connector: ConnectorForRuntime & { versionId: string; allowUrlToken: boolean }; tools: PublishedAction[] } | null> {
  const d = db();
  const [row] = await d
    .select({ c: connectors, revokedAt: workspaces.revokedAt })
    .from(connectors)
    .innerJoin(workspaces, eq(connectors.workspaceId, workspaces.id))
    .where(eq(connectors.id, connectorId))
    .limit(1);
  // A revoked workspace's servers stop answering too, not just its sign-in.
  if (!row || row.revokedAt) return null;
  const c = row.c;
  if (c.status !== "published" || !c.currentVersionId) return null;
  const rows = await d
    .select()
    .from(actions)
    .where(and(eq(actions.versionId, c.currentVersionId), eq(actions.enabled, true)));
  return {
    connector: {
      id: c.id,
      name: c.name,
      baseUrl: c.baseUrl,
      authType: c.authType,
      authConfig: c.authConfig ?? null,
      versionId: c.currentVersionId,
      allowUrlToken: c.allowUrlToken,
    },
    tools: rows.map((a) => ({
      id: a.id,
      versionId: a.versionId,
      key: a.key,
      title: a.title,
      description: a.description,
      method: a.method,
      path: a.path,
      params: a.params,
      successCheck: a.successCheck,
      risk: a.risk,
      requiresApproval: a.requiresApproval,
    })),
  };
}

/** Tool description as the model sees it: the reviewed description plus how it behaves. */
export function toolDescription(t: PublishedAction): string {
  const notes: string[] = [];
  if (t.risk === "destructive") notes.push("Destructive: a person must approve each call before it runs.");
  else if (t.requiresApproval) notes.push("Changes data: a person must approve each call before it runs.");
  else if (t.risk === "read") notes.push("Read-only.");
  return [t.description ?? t.title, ...notes].join(" ");
}

function asText(data: unknown): string {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return text.length > RESULT_MAX_CHARS ? `${text.slice(0, RESULT_MAX_CHARS)}\n… (shortened: ${text.length.toLocaleString("en-US")} characters in total)` : text;
}

export function buildMcpHandler(loaded: NonNullable<Awaited<ReturnType<typeof loadPublished>>>) {
  const { connector, tools } = loaded;
  return createMcpHandler(
    (server) => {
      for (const tool of tools) {
        const plan = toolInputPlan(tool.params);
        server.registerTool(
          tool.key,
          {
            title: tool.title,
            description: toolDescription(tool),
            inputSchema: fromJsonSchema<Record<string, unknown>>(plan.schema as never),
            annotations: { ...toolAnnotations(tool.risk), idempotentHint: tool.method === "GET", openWorldHint: true },
          },
          async (args): Promise<CallToolResult> => {
            const outcome = await runToolCall(connector, tool, (args ?? {}) as Record<string, unknown>);
            if (outcome.kind === "pending_approval") {
              // Email the workspace (if it asked) after this reply is sent; never blocks or fails the call.
              const approvalId = outcome.approvalId;
              const send = () => notifyApprovalWaiting(approvalId).catch(() => undefined);
              try {
                after(send);
              } catch {
                void send(); // outside a Next request (in-process tests): just don't wait for it
              }
              return {
                content: [
                  {
                    type: "text",
                    text: `Waiting for approval. A person needs to approve this in BYOMCP before it runs: ${outcome.summary}. Request apr_${outcome.approvalId.slice(0, 8)}. Don't retry: approving it will run it once. Use ${CHECK_TOOL} with this request ID to see the outcome later.`,
                  },
                ],
              };
            }
            if (outcome.status === "success") {
              return { content: [{ type: "text", text: asText(outcome.data ?? "") || "Done (no content returned)." }] };
            }
            return { content: [{ type: "text", text: outcome.reason ?? "The call failed." }], isError: true };
          },
        );
      }

      // MCP is stateless, so the model can't be told when a person approves.
      // It can ask instead. Only registered when some tool can need approval.
      if (tools.some((t) => t.requiresApproval || t.risk === "destructive") && !tools.some((t) => t.key === CHECK_TOOL)) {
        server.registerTool(
          CHECK_TOOL,
          {
            title: "Check an approval",
            description: `Check whether a person has approved a request that was waiting for approval in BYOMCP, and get its result. Pass the request ID from the earlier reply (like apr_1a2b3c4d). Read-only.`,
            inputSchema: fromJsonSchema<{ request_id: string }>({
              type: "object",
              properties: { request_id: { type: "string", pattern: "^(apr_)?[0-9a-fA-F]{8}$", description: "The request ID, e.g. apr_1a2b3c4d" } },
              required: ["request_id"],
              additionalProperties: false,
            } as never),
            annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          },
          async (args): Promise<CallToolResult> => {
            const id = String((args as { request_id?: string })?.request_id ?? "");
            const s = await approvalStatusForConnector(connector.id, id);
            if (!s) return { content: [{ type: "text", text: `No request ${id} found for ${connector.name}.` }], isError: true };
            const head = `Request ${id.startsWith("apr_") ? id : `apr_${id}`} (${s.summary}): `;
            if (s.status === "pending") return { content: [{ type: "text", text: `${head}still waiting for a person to approve it.` }] };
            if (s.status === "rejected") return { content: [{ type: "text", text: `${head}rejected by a person. It was not run.` }] };
            if (s.status === "expired") return { content: [{ type: "text", text: `${head}expired before anyone approved it. It was not run.` }] };
            const r = s.result;
            const ok = r?.status === "success";
            return {
              content: [
                {
                  type: "text",
                  text: `${head}approved and run. ${ok ? "It worked" : `It failed: ${r?.reason ?? r?.status}`}${r?.httpStatus ? ` (HTTP ${r.httpStatus})` : ""}.${r?.preview ? `\n\n${r.preview}` : ""}`,
                },
              ],
              isError: !ok,
            };
          },
        );
      }
    },
    {
      serverInfo: { name: `byomcp-${connector.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "")}`, version: "1.0.0" },
      instructions: `Tools for ${connector.name}, generated from its API docs and reviewed by a person. Read-only tools run immediately. Tools that change data may need a person's approval; when a result says it's waiting for approval, tell the user instead of retrying.`,
    },
  );
}

/** Route handler for /api/mcp/:connectorId (bearer token in the Authorization header). */
export async function handleMcpRequest(req: Request, connectorId: string): Promise<Response> {
  const loaded = await loadPublished(connectorId);
  if (!loaded) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "No published MCP server here. Publish the app in BYOMCP first." } },
      { status: 404 },
    );
  }
  const authed = withMcpAuth(
    buildMcpHandler(loaded),
    async (_req, bearer) => {
      const check = await verifyEndpointToken(connectorId, bearer);
      return check.ok ? { token: bearer!, clientId: `byomcp:${check.kind}`, scopes: [], extra: { connectorId } } : undefined;
    },
    { required: true },
  );
  return authed(req);
}

/** Opt-in route /api/mcp/:connectorId/k/:token, for clients that can't send headers. */
export async function handleMcpRequestWithUrlToken(req: Request, connectorId: string, token: string): Promise<Response> {
  const loaded = await loadPublished(connectorId);
  if (!loaded || !loaded.connector.allowUrlToken) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "This address isn't enabled." } }, { status: 404 });
  }
  const check = await verifyEndpointToken(connectorId, token);
  if (!check.ok || check.kind !== "endpoint") {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Invalid or revoked token." } }, { status: 401 });
  }
  return buildMcpHandler(loaded)(req);
}
