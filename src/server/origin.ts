import "server-only";

/**
 * This app's public origin, from the deployment environment, never from the
 * request's Host header (which a client controls). Used for the MCP URL we show
 * and for the test console's server-side calls to our own endpoint.
 */
export function appOrigin(): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV === "production" && prod) return `https://${prod}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export const mcpUrl = (connectorId: string) => `${appOrigin()}/api/mcp/${connectorId}`;
