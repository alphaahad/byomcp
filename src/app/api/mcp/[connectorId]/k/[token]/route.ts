import { z } from "zod";
import { handleMcpRequestWithUrlToken } from "@/server/mcp/server";

/** Opt-in, less secure: token in the URL, for MCP clients that can't send headers. Off unless enabled per app. */
export const maxDuration = 60;

async function handler(req: Request, ctx: RouteContext<"/api/mcp/[connectorId]/k/[token]">) {
  const { connectorId, token } = await ctx.params;
  if (!z.uuid().safeParse(connectorId).success) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Not found." } }, { status: 404 });
  }
  return handleMcpRequestWithUrlToken(req, connectorId, token);
}

export { handler as GET, handler as POST, handler as DELETE };
