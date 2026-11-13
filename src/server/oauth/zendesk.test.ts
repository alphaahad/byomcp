import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/origin", () => ({ appOrigin: () => "https://byomcp.example" }));
vi.mock("@/server/env", () => ({
  env: () => ({ ZENDESK_OAUTH_CLIENT_ID: "byomcp", ZENDESK_OAUTH_CLIENT_SECRET: "s3cret", ZENDESK_OAUTH_SUBDOMAIN: "Acme" }),
}));
const safeFetch = vi.fn();
vi.mock("@/server/net/safe-fetch", () => ({ safeFetch: (...a: unknown[]) => safeFetch(...a) }));

const reply = (status: number, body: unknown) => ({ status, text: () => JSON.stringify(body) });

describe("Connect with Zendesk", () => {
  beforeEach(() => safeFetch.mockReset());

  it("builds the consent URL with PKCE, scope and the redirect", async () => {
    const z = await import("./zendesk");
    const cfg = z.zendeskOAuthConfig()!;
    expect(cfg.subdomain).toBe("acme");
    const u = new URL(z.zendeskAuthorizeUrl(cfg, "STATE", "CHALLENGE"));
    expect(u.origin + u.pathname).toBe("https://acme.zendesk.com/oauth/authorizations/new");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: "code",
      client_id: "byomcp",
      redirect_uri: "https://byomcp.example/api/oauth/zendesk/callback",
      scope: "read write",
      state: "STATE",
      code_challenge: "CHALLENGE",
      code_challenge_method: "S256",
    });
  });

  it("exchanges the code and keeps both tokens with their expiry", async () => {
    const z = await import("./zendesk");
    safeFetch.mockResolvedValue(reply(201, { access_token: "AT", refresh_token: "RT", token_type: "bearer", expires_in: 1800, refresh_token_expires_in: 7776000 }));
    const before = Date.now();
    const s = await z.exchangeZendeskCode(z.zendeskOAuthConfig()!, "CODE", "VERIFIER");
    const [url, opts] = safeFetch.mock.calls[0];
    expect(url).toBe("https://acme.zendesk.com/oauth/tokens");
    expect(JSON.parse(opts.body)).toMatchObject({ grant_type: "authorization_code", code: "CODE", code_verifier: "VERIFIER", client_id: "byomcp", client_secret: "s3cret", redirect_uri: "https://byomcp.example/api/oauth/zendesk/callback" });
    expect(s).toMatchObject({ kind: "oauth", subdomain: "acme", accessToken: "AT", refreshToken: "RT" });
    expect(s.expiresAt! - before).toBeGreaterThanOrEqual(1800_000 - 50);
  });

  it("refreshes with the refresh token and reports a rotated-away token as invalid_grant", async () => {
    const z = await import("./zendesk");
    safeFetch.mockResolvedValueOnce(reply(201, { access_token: "AT2", refresh_token: "RT2", expires_in: 1800 }));
    const s = await z.refreshZendeskToken(z.zendeskOAuthConfig()!, "RT");
    expect(JSON.parse(safeFetch.mock.calls[0][1].body)).toMatchObject({ grant_type: "refresh_token", refresh_token: "RT" });
    expect(s.refreshToken).toBe("RT2");

    safeFetch.mockResolvedValueOnce(reply(400, { error: "invalid_grant", error_description: "x" }));
    await expect(z.refreshZendeskToken(z.zendeskOAuthConfig()!, "RT")).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("refuses an answer without a refresh token", async () => {
    const z = await import("./zendesk");
    safeFetch.mockResolvedValue(reply(201, { access_token: "AT" }));
    await expect(z.exchangeZendeskCode(z.zendeskOAuthConfig()!, "C", "V")).rejects.toThrow(/refresh token/);
  });
});
