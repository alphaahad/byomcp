import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("approval emails", () => {
  it("throttles to one email per workspace per 10 minutes", async () => {
    const { shouldNotify, NOTIFY_THROTTLE_MS } = await import("./email");
    const now = Date.now();
    expect(shouldNotify(null, now)).toBe(true);
    expect(shouldNotify(new Date(now - 60_000), now)).toBe(false);
    expect(shouldNotify(new Date(now - NOTIFY_THROTTLE_MS), now)).toBe(true);
  });

  it("escapes the app name and summary, and never needs the payload", async () => {
    const { approvalEmail } = await import("./email");
    const mail = approvalEmail({ appName: "Acme <script>", summary: 'Create "x" & <b>y</b>', link: "https://byomcp.example/approvals", waitingCount: 3 });
    expect(mail.subject).toBe("Approval needed: Acme <script>");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("Acme &lt;script&gt;");
    expect(mail.html).toContain("Create &quot;x&quot; &amp; &lt;b&gt;y&lt;/b&gt;");
    expect(mail.html).toContain("2 more requests are waiting too.");
    expect(mail.text).toContain("https://byomcp.example/approvals");
  });
});

describe("confirmation links", () => {
  it("verify only untampered, unexpired tokens for the same address and workspace", async () => {
    vi.doMock("@/server/env", () => ({ env: () => ({ CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64") }) }));
    vi.resetModules();
    const { signConfirmToken, verifyConfirmToken } = await import("./email");
    const t = signConfirmToken("w1", "a@example.com");
    expect(verifyConfirmToken(t)).toEqual({ workspaceId: "w1", email: "a@example.com" });
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ w: "w1", e: "evil@example.com", x: Date.now() + 1e6 })).toString("base64url");
    expect(verifyConfirmToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyConfirmToken(`${payload}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(verifyConfirmToken(signConfirmToken("w1", "a@example.com", Date.now() - 25 * 3600 * 1000))).toBeNull();
    vi.doUnmock("@/server/env");
  });
});
