import { describe, expect, it } from "vitest";
import { toolInputPlan } from "@/lib/tool-input";
import type { SafeFetchOptions, SafeFetchResponse } from "@/server/net/safe-fetch";
import { SafeFetchError } from "@/server/net/safe-fetch";
import { apiMessage, buildRequest, execute, type Connection, type ExecAction } from "./executor";

const getTicket: ExecAction = {
  key: "get_ticket",
  method: "GET",
  path: "/tickets/{id}",
  params: {
    path: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    query: { type: "object", properties: { include: { type: "array", items: { type: "string" } } } },
    headers: { type: "object", properties: { "X-Locale": { type: "string" } } },
  },
};

const createTicket: ExecAction = {
  key: "create_ticket",
  method: "POST",
  path: "/tickets",
  params: {
    path: { type: "object", properties: {} },
    query: { type: "object", properties: {} },
    headers: { type: "object", properties: {} },
    body: { type: "object", properties: { subject: { type: "string" } }, required: ["subject"] },
  },
  successCheck: { field: "id" },
};

const conn = (over: Partial<Connection> = {}): Connection => ({
  baseUrl: "https://acme.helpdesk.example.com/api/v2",
  authType: "api_key",
  apiKey: { in: "header", name: "X-Api-Key" },
  secret: { kind: "api_key", value: "sk_test_secret_123" },
  ...over,
});

type Call = { url: string; opts: SafeFetchOptions };
type Fake = { status?: number; headers?: SafeFetchResponse["headers"]; body?: string };
function fakeSend(responses: (Fake | Error)[]) {
  const calls: Call[] = [];
  const send = async (url: string, opts: SafeFetchOptions): Promise<SafeFetchResponse> => {
    calls.push({ url, opts });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    const body = Buffer.from(r.body ?? "");
    return { status: r.status ?? 200, headers: r.headers ?? { "content-type": "application/json" }, body, url, text: () => body.toString() };
  };
  return { send, calls };
}

describe("buildRequest: fixed headers", () => {
  const notionPage: ExecAction = {
    ...getTicket,
    params: {
      ...getTicket.params,
      headers: { type: "object", properties: { "Notion-Version": { enum: ["2026-03-11"], default: "2026-03-11" } } },
    },
  };
  it("sends a one-value header the caller left out, and can't be used to override auth", () => {
    const req = buildRequest(notionPage, { id: "p1" }, conn());
    expect(req.headers["Notion-Version"]).toBe("2026-03-11");
    expect(req.headers["X-Api-Key"]).toBe("sk_test_secret_123");
  });
  it("leaves ordinary optional headers out when not given", () => {
    expect(buildRequest(getTicket, { id: "t1" }, conn()).headers["X-Locale"]).toBeUndefined();
  });
});

describe("buildRequest: a key kept in the path (GREEN-API)", () => {
  const send: ExecAction = {
    key: "send_message",
    method: "POST",
    path: "/sendMessage/{apiTokenInstance}",
    params: {
      path: { type: "object", properties: { apiTokenInstance: { type: "string", "x-byomcp-credential": true } } },
      query: { type: "object", properties: {} },
      headers: { type: "object", properties: {} },
      body: { type: "object", properties: { chatId: { type: "string" }, message: { type: "string" } }, required: ["chatId", "message"] },
    },
  };
  const pathConn = conn({
    baseUrl: "https://1103.api.green-api.com/waInstance1101",
    apiKey: { in: "path", name: "apiTokenInstance" },
    secret: { kind: "api_key", value: "tok/en 123" },
  });

  it("never shows the key to the AI employee", () => {
    const plan = toolInputPlan(send.params);
    expect(plan.schema.properties).not.toHaveProperty("apiTokenInstance");
    expect(plan.schema.required).toEqual(["chatId", "message"]);
  });
  it("fills it from the saved key (encoded), and doesn't also send it as a header", () => {
    const req = buildRequest(send, { chatId: "1@c.us", message: "hi" }, pathConn);
    expect(req.url).toBe("https://1103.api.green-api.com/waInstance1101/sendMessage/tok%2Fen%20123");
    expect(req.headers).not.toHaveProperty("apiTokenInstance");
  });
  it("ignores a value the caller tries to pass, and refuses without a saved key", () => {
    const req = buildRequest(send, { chatId: "1@c.us", message: "hi", apiTokenInstance: "evil" } as Record<string, unknown>, pathConn);
    expect(req.url).not.toContain("evil");
    expect(() => buildRequest(send, { chatId: "1@c.us", message: "hi" }, conn())).toThrow(/Connect this app's key/);
  });
  it("keeps the key out of the logged URL", async () => {
    const { send: fake } = fakeSend([{ body: '{"idMessage":"m1"}' }]);
    const out = await execute(send, { chatId: "1@c.us", message: "hi" }, pathConn, { send: fake });
    expect(out.request.url).not.toContain("tok%2Fen%20123");
    expect(out.request.url).not.toContain("tok/en 123");
  });
});

describe("buildRequest: form bodies", () => {
  it("sends a body marked as a form as form fields", () => {
    const sms: ExecAction = {
      ...createTicket,
      params: { ...createTicket.params, body: { type: "object", properties: { to: { type: "string" }, sender: { type: "string" } }, "x-byomcp-form": true } },
    };
    const req = buildRequest(sms, { to: "919812345678", sender: "KLRHXA" }, conn());
    expect(req.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(req.body).toBe("to=919812345678&sender=KLRHXA");
  });
});

describe("buildRequest: path safety", () => {
  it("refuses '.' and '..' as path values, which survive URL encoding", () => {
    expect(() => buildRequest(getTicket, { id: ".." }, conn())).toThrow(/can't be/);
    expect(() => buildRequest(getTicket, { id: "." }, conn())).toThrow(/can't be/);
  });
  it("keeps requests under the base path ('/api/v2' doesn't cover '/api/v2-admin')", () => {
    const sibling = { ...getTicket, path: "-admin/tickets" };
    expect(() => buildRequest(sibling, {}, conn())).toThrow(/leave the app's server address/);
  });
});

describe("buildRequest", () => {
  it("fills and encodes path params, repeats array query params, injects the key last", () => {
    const req = buildRequest(getTicket, { id: "../admin/1", include: ["a", "b"], "X-Locale": "en" }, conn());
    expect(req.url).toBe("https://acme.helpdesk.example.com/api/v2/tickets/..%2Fadmin%2F1?include=a&include=b");
    expect(req.headers["X-Api-Key"]).toBe("sk_test_secret_123");
    expect(req.headers["X-Locale"]).toBe("en");
  });

  it("supports query-string keys, bearer and basic", () => {
    expect(buildRequest(getTicket, { id: "1" }, conn({ apiKey: { in: "query", name: "api_key" } })).url).toContain("api_key=sk_test_secret_123");
    expect(buildRequest(getTicket, { id: "1" }, conn({ authType: "bearer", secret: { kind: "bearer", token: "tok" } })).headers.authorization).toBe("Bearer tok");
    expect(buildRequest(getTicket, { id: "1" }, conn({ authType: "basic", secret: { kind: "basic", username: "key", password: "x" } })).headers.authorization).toBe(
      `Basic ${Buffer.from("key:x").toString("base64")}`,
    );
  });

  it("blocks header injection and auth overrides", () => {
    const withHeader = (name: string): ExecAction => ({
      ...getTicket,
      params: { ...getTicket.params, headers: { type: "object", properties: { [name]: { type: "string" } } } },
    });
    expect(() => buildRequest(withHeader("X-Locale"), { id: "1", "X-Locale": "en\r\nX-Evil: 1" }, conn())).toThrow(/line breaks/);
    expect(() => buildRequest(withHeader("Authorization"), { id: "1", Authorization: "Bearer stolen" }, conn())).toThrow(/can't be set/);
  });

  it("sends JSON bodies, never on GET", () => {
    const req = buildRequest(createTicket, { subject: "Hi" }, conn());
    expect(req.body).toBe('{"subject":"Hi"}');
    expect(req.headers["content-type"]).toBe("application/json");
  });
});

describe("tool input plan", () => {
  it("is flat, and nests the body only on a name clash", () => {
    expect(Object.keys(toolInputPlan(createTicket.params).schema.properties)).toEqual(["subject"]);
    const clash = toolInputPlan({
      ...createTicket.params,
      path: { type: "object", properties: { subject: { type: "string" } }, required: ["subject"] },
    });
    expect(clash.where).toEqual({ subject: "path", body: "bodyWhole" });
  });
});

describe("execute: classification", () => {
  it("success, and the secret never appears in the result", async () => {
    const { send, calls } = fakeSend([{ status: 200, body: '{"id":"7","echo":"sk_test_secret_123"}' }]);
    const r = await execute(getTicket, { id: "7" }, conn(), { send });
    expect(r.status).toBe("success");
    expect(JSON.stringify(r)).not.toContain("sk_test_secret_123");
    expect(r.preview).toContain("[hidden]");
    expect(calls[0].opts.maxRedirects).toBe(0);
  });

  it("validation errors never reach the network", async () => {
    const { send, calls } = fakeSend([{ status: 200, body: "{}" }]);
    const r = await execute(createTicket, { subjekt: "typo" }, conn(), { send });
    expect(r.status).toBe("validation_error");
    expect(r.reason).toMatch(/"subject" is required/);
    expect(calls).toHaveLength(0);
  });

  it("empty_or_invalid when the success check fails, or a GET returns nothing", async () => {
    expect((await execute(createTicket, { subject: "Hi" }, conn(), { send: fakeSend([{ status: 201, body: '{"ok":true}' }]).send })).status).toBe("empty_or_invalid");
    expect((await execute(getTicket, { id: "1" }, conn(), { send: fakeSend([{ status: 200, body: "" }]).send })).status).toBe("empty_or_invalid");
  });

  it("auth_failed on 401/403, with the API's message", async () => {
    const r = await execute(getTicket, { id: "1" }, conn(), { send: fakeSend([{ status: 401, body: '{"error":{"message":"Invalid API key"}}' }]).send });
    expect(r.status).toBe("auth_failed");
    expect(r.reason).toContain("Invalid API key");
  });

  it("retries reads on 429/5xx/timeouts, then gives up as transient_failed", async () => {
    const flaky = fakeSend([{ status: 503, body: "" }, new SafeFetchError("timeout", "slow"), { status: 200, body: '{"id":"1"}' }]);
    const ok = await execute(getTicket, { id: "1" }, conn(), { send: flaky.send, retryDelaysMs: [0, 0] });
    expect(ok).toMatchObject({ status: "success", attempts: 3 });

    const down = fakeSend([{ status: 500, body: "" }]);
    const failed = await execute(getTicket, { id: "1" }, conn(), { send: down.send, retryDelaysMs: [0, 0] });
    expect(failed).toMatchObject({ status: "transient_failed", attempts: 3 });
  });

  it("never auto-retries writes", async () => {
    const { send, calls } = fakeSend([{ status: 503, body: "" }]);
    const r = await execute(createTicket, { subject: "Hi" }, conn(), { send, retryDelaysMs: [0, 0] });
    expect(r.status).toBe("transient_failed");
    expect(calls).toHaveLength(1);
  });

  it("request_error on other 4xx, and on blocked addresses", async () => {
    const r = await execute(getTicket, { id: "1" }, conn(), { send: fakeSend([{ status: 422, body: '{"errors":[{"message":"id must be numeric"}]}' }]).send });
    expect(r).toMatchObject({ status: "request_error" });
    expect(r.reason).toContain("id must be numeric");
    const blocked = await execute(getTicket, { id: "1" }, conn(), {
      send: fakeSend([new SafeFetchError("blocked_address", "That address points to a private network, which isn't allowed.")]).send,
    });
    expect(blocked.status).toBe("request_error");
  });
});

describe("apiMessage", () => {
  it("reads common error shapes", () => {
    expect(apiMessage({ message: "Nope" })).toBe("Nope");
    expect(apiMessage({ error: "invalid_token", error_description: "Expired" })).toBe("Expired");
    expect(apiMessage({ errors: [{ detail: "Bad field" }] })).toBe("Bad field");
    expect(apiMessage({})).toBeNull();
  });
});
