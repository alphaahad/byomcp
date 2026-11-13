import { z } from "zod";
import { handleMcpRequest } from "@/server/mcp/server";

/**
 * MCP endpoint (Streamable HTTP). Public route: outside the passcode gate,
 * authenticated by the connector's endpoint token (Authorization: Bearer …).
 */
export const maxDuration = 60;

async function handler(req: Request, ctx: RouteContext<"/api/mcp/[connectorId]">) {
  const { connectorId } = await ctx.params;
  if (!z.uuid().safeParse(connectorId).success) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Not found." } }, { status: 404 });
  }
  return handleMcpRequest(req, connectorId);
}

export { handler as GET, handler as POST, handler as DELETE };
