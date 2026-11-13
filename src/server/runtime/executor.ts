import "server-only";
/**
 * Deterministic request executor: stored action + input + connection → HTTP
 * call → classified result. No LLM anywhere. Shared by "Try it", approvals and
 * the MCP runtime. SPEC 7.5.
 */
import { Ajv } from "ajv";
import type { ActionIR, HttpMethod } from "@/lib/ir";
import { FORM_FLAG, isCredentialParam, splitInput, toolInputPlan, type ToolInputPlan } from "@/lib/tool-input";
import type { Secret } from "@/server/crypto/credentials";
import { secretValues } from "@/server/crypto/credentials";
import { SafeFetchError, safeFetch, type SafeFetchOptions, type SafeFetchResponse } from "@/server/net/safe-fetch";

export type CallStatus = "success" | "empty_or_invalid" | "auth_failed" | "transient_failed" | "request_error" | "validation_error";

export type ExecAction = Pick<ActionIR, "method" | "path" | "params"> & {
  key: string;
  successCheck?: ActionIR["successCheck"] | null; // DB rows store "none" as null
};

export type Connection = {
  baseUrl: string;
  authType: "none" | "api_key" | "bearer" | "basic";
  apiKey?: { in: "header" | "query" | "path"; name: string };
  secret: Secret | null;
};

export type ExecResult = {
  status: CallStatus;
  httpStatus: number | null;
  attempts: number;
  durationMs: number;
  /** Plain-language reason when not a success. */
  reason: string | null;
  /** Parsed response (JSON) or text, secrets scrubbed. Large values are truncated for display by the caller. */
  data: unknown;
  /** Short scrubbed text of the response for logs (≤ 2,000 chars). */
  preview: string;
  request: { method: HttpMethod; url: string }; // URL has secrets scrubbed
};

export type Sender = (url: string, opts: SafeFetchOptions) => Promise<SafeFetchResponse>;

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false, useDefaults: false });
const validators = new WeakMap<object, ReturnType<typeof ajv.compile>>();

const FORBIDDEN_HEADERS = /^(authorization|proxy-.*|cookie|host|content-length|transfer-encoding|connection|te|upgrade|x-forwarded-.*|forwarded)$/i;
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 2 * 1024 * 1024;
const PREVIEW_CHARS = 2000;

export class InputError extends Error {}

/** Validate flat tool input against the action's schema. Returns plain-language problems. */
export function validateInput(plan: ToolInputPlan, input: unknown): string[] {
  let validate = validators.get(plan.schema);
  if (!validate) {
    validate = ajv.compile(plan.schema);
    validators.set(plan.schema, validate);
  }
  if (validate(input)) return [];
  return (validate.errors ?? []).slice(0, 5).map((e) => {
    const field = e.instancePath.replace(/^\//, "").replace(/\//g, ".");
    if (e.keyword === "required") return `"${(e.params as { missingProperty: string }).missingProperty}" is required.`;
    if (e.keyword === "additionalProperties") return `"${(e.params as { additionalProperty: string }).additionalProperty}" isn't an input of this action.`;
    return `${field ? `"${field}"` : "Input"} ${e.message ?? "is invalid"}.`;
  });
}

function stringify(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** Build the outgoing request. Throws InputError for anything that would change the request's shape. */
export function buildRequest(action: ExecAction, input: Record<string, unknown>, conn: Connection) {
  const plan = toolInputPlan(action.params);
  const parts = splitInput(plan, input);
  const base = new URL(conn.baseUrl);

  const pathKey = conn.authType === "api_key" && conn.apiKey?.in === "path" && conn.secret?.kind === "api_key" ? conn.apiKey.name : null;
  const path = action.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    // A key that the app expects inside the path (GREEN-API) is filled from the saved secret, never from input.
    if (isCredentialParam(action.params.path.properties[name])) {
      if (name !== pathKey || conn.secret?.kind !== "api_key") throw new InputError("Connect this app's key first.");
      return encodeURIComponent(conn.secret.value);
    }
    const v = parts.path[name];
    if (v === undefined || v === null || v === "") throw new InputError(`"${name}" is required.`);
    // Encoded, so "a/b" can't add a segment; "." and ".." survive encoding, so refuse them outright.
    const s = stringify(v);
    if (s === "." || s === "..") throw new InputError(`"${name}" can't be "${s}".`);
    return encodeURIComponent(s);
  });
  const url = new URL(base.toString().replace(/\/+$/, "") + path);
  // Defence in depth: the request must stay on the confirmed host and under its base path
  // ("/api" must not match "/api-admin", so compare against the path with a trailing slash).
  const basePath = base.pathname.replace(/\/+$/, "");
  const inside = !basePath || url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
  if (url.origin !== base.origin || !inside) {
    throw new InputError("That request would leave the app's server address.");
  }
  for (const [k, v] of Object.entries(parts.query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, stringify(item)));
    else url.searchParams.set(k, stringify(v));
  }

  const headers: Record<string, string> = { accept: "application/json, */*;q=0.5" };
  // Fixed headers (one allowed value, e.g. Notion-Version) are sent even when the caller leaves them out.
  const fixedHeaders: Record<string, unknown> = {};
  for (const [k, schema] of Object.entries(action.params.headers?.properties ?? {})) {
    const s = schema as { default?: unknown; enum?: unknown[]; const?: unknown };
    const only = s.const ?? (Array.isArray(s.enum) && s.enum.length === 1 ? s.enum[0] : undefined);
    if (only !== undefined && s.default === only) fixedHeaders[k] = only;
  }
  for (const [k, v] of Object.entries({ ...fixedHeaders, ...parts.headers })) {
    if (v === undefined || v === null) continue;
    if (FORBIDDEN_HEADERS.test(k)) throw new InputError(`The "${k}" header can't be set by a tool call.`);
    const value = stringify(v);
    if (/[\r\n]/.test(value)) throw new InputError(`The "${k}" header can't contain line breaks.`);
    headers[k] = value;
  }

  // Credentials go in last so nothing above can override them.
  const s = conn.secret;
  if (conn.authType === "api_key" && s?.kind === "api_key" && conn.apiKey) {
    if (conn.apiKey.in === "path") {
      // Already placed in the path above.
    } else if (conn.apiKey.in === "query") url.searchParams.set(conn.apiKey.name, s.value);
    else headers[conn.apiKey.name] = s.value;
  } else if (conn.authType === "bearer" && s?.kind === "bearer") {
    headers.authorization = `Bearer ${s.token}`;
  } else if (conn.authType === "basic" && s?.kind === "basic") {
    headers.authorization = `Basic ${Buffer.from(`${s.username}:${s.password}`).toString("base64")}`;
  }

  let body: string | undefined;
  if (parts.body !== undefined && action.method !== "GET" && action.method !== "DELETE") {
    const asForm = (action.params.body as Record<string, unknown> | undefined)?.[FORM_FLAG] === true;
    if (asForm && parts.body && typeof parts.body === "object" && !Array.isArray(parts.body)) {
      // Form fields: arrays repeat the key; objects are sent as JSON text.
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(parts.body as Record<string, unknown>)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) v.forEach((item) => form.append(k, stringify(item)));
        else form.append(k, stringify(v));
      }
      body = form.toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    } else {
      body = JSON.stringify(parts.body);
      headers["content-type"] = "application/json";
    }
  }
  return { url: url.toString(), method: action.method, headers, body };
}

function scrubber(secret: Secret | null) {
  // Hide each secret as typed and as it appears in a URL (a key kept in the path is encoded).
  const raw = secret ? secretValues(secret) : [];
  const vals = [...new Set(raw.flatMap((v) => [v, encodeURIComponent(v)]))].filter(Boolean).sort((a, b) => b.length - a.length);
  return (text: string) => vals.reduce((t, v) => t.split(v).join("[hidden]"), text);
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, k) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined), obj);
}

/** Best-effort error message from common API error shapes. */
export function apiMessage(data: unknown): string | null {
  const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (typeof data === "string") return pick(data.slice(0, 300));
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const errors = Array.isArray(d.errors) ? (d.errors[0] as Record<string, unknown> | string | undefined) : undefined;
  return (
    pick(d.message) ??
    pick(d.error_description) ??
    pick(d.detail) ??
    pick(typeof d.error === "object" && d.error ? (d.error as Record<string, unknown>).message : d.error) ??
    pick(typeof errors === "string" ? errors : errors?.message ?? errors?.detail) ??
    pick(d.title) ??
    null
  )?.slice(0, 300) ?? null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run one call and classify it:
 *  2xx + success check passes → success; 2xx but check fails / empty when data
 *  expected → empty_or_invalid; 401/403 → auth_failed; 429/5xx/timeout →
 *  transient_failed (reads retried up to 2×, writes never auto-retried);
 *  other 4xx → request_error with the API's own message.
 */
export async function execute(
  action: ExecAction,
  input: Record<string, unknown>,
  conn: Connection,
  opts: { send?: Sender; retryDelaysMs?: number[] } = {},
): Promise<ExecResult> {
  const started = Date.now();
  const scrub = scrubber(conn.secret);
  const plan = toolInputPlan(action.params);
  const result = (r: Omit<ExecResult, "durationMs" | "request"> & { url?: string }): ExecResult => ({
    status: r.status,
    httpStatus: r.httpStatus,
    attempts: r.attempts,
    reason: r.reason,
    data: r.data,
    preview: r.preview,
    durationMs: Date.now() - started,
    request: { method: action.method, url: scrub(r.url ?? "") },
  });

  const problems = validateInput(plan, input);
  if (problems.length) {
    return result({ status: "validation_error", httpStatus: null, attempts: 0, reason: problems.join(" "), data: null, preview: "" });
  }
  let req: ReturnType<typeof buildRequest>;
  try {
    req = buildRequest(action, input, conn);
  } catch (err) {
    if (err instanceof InputError) {
      return result({ status: "validation_error", httpStatus: null, attempts: 0, reason: err.message, data: null, preview: "" });
    }
    throw err;
  }

  const send = opts.send ?? safeFetch;
  const retryable = action.method === "GET";
  const delays = opts.retryDelaysMs ?? [500, 1500];
  let attempts = 0;
  for (;;) {
    attempts++;
    let res: SafeFetchResponse;
    try {
      res = await send(req.url, { method: req.method, headers: req.headers, body: req.body, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES, maxRedirects: 0 });
    } catch (err) {
      const e = err instanceof SafeFetchError ? err : null;
      const transient = !e || e.code === "timeout" || e.code === "network" || e.code === "dns_failed";
      if (transient && retryable && attempts <= delays.length) {
        await sleep(delays[attempts - 1]);
        continue;
      }
      return result({
        status: transient ? "transient_failed" : "request_error",
        httpStatus: null,
        attempts,
        reason: e?.message ?? "Couldn't reach the app.",
        data: null,
        preview: "",
        url: req.url,
      });
    }

    const text = scrub(res.text());
    const type = String(res.headers["content-type"] ?? "");
    let data: unknown = text;
    if (/json/i.test(type) || /^\s*[[{]/.test(text)) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    const preview = text.slice(0, PREVIEW_CHARS);
    const base = { httpStatus: res.status, attempts, data, preview, url: req.url };

    if (res.status >= 200 && res.status < 300) {
      if (action.successCheck) {
        const v = getPath(data, action.successCheck.field);
        if (v === undefined || v === null || v === "") {
          return result({
            ...base,
            status: "empty_or_invalid",
            reason: `The app said OK but didn't return "${action.successCheck.field}", so we can't confirm it worked.`,
          });
        }
      }
      if (action.method === "GET" && res.status !== 204 && text.trim() === "") {
        return result({ ...base, status: "empty_or_invalid", reason: "The app said OK but sent back no data." });
      }
      return result({ ...base, status: "success", reason: null });
    }
    if (res.status === 401 || res.status === 403) {
      const msg = apiMessage(data);
      return result({
        ...base,
        status: "auth_failed",
        reason: `The app rejected the saved key (HTTP ${res.status})${msg ? `: ${msg}` : ""}. Check the key has access, then reconnect.`,
      });
    }
    if (res.status === 429 || res.status >= 500) {
      if (retryable && attempts <= delays.length) {
        const after = Number(res.headers["retry-after"]);
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 5000) : delays[attempts - 1]);
        continue;
      }
      return result({
        ...base,
        status: "transient_failed",
        reason: res.status === 429 ? "The app is rate-limiting requests. Try again in a minute." : `The app had a problem (HTTP ${res.status}). Try again shortly.`,
      });
    }
    if (res.status >= 300 && res.status < 400) {
      return result({ ...base, status: "request_error", reason: `The app redirected the request (HTTP ${res.status}). Check the server address.` });
    }
    const msg = apiMessage(data);
    if (res.status === 404 && !msg) {
      return result({ ...base, status: "request_error", reason: "The app found nothing at that address (HTTP 404). Check the app's address in Connection, and any IDs you entered." });
    }
    return result({ ...base, status: "request_error", reason: `The app said the request was wrong (HTTP ${res.status})${msg ? `: ${msg}` : "."}` });
  }
}
