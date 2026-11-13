import "server-only";
/**
 * The only way server code talks to the internet (docs fetching now, the MCP
 * runtime later). SSRF guard per SPEC 7.6:
 *  - https only
 *  - every resolved address is checked at connect time (custom `lookup`), so a
 *    hostname can't pass a check and then re-resolve to a private IP (DNS rebinding)
 *  - IP-literal hosts are checked up front (Node skips `lookup` for them)
 *  - redirects followed manually, each hop re-checked, capped
 *  - total time limit and a byte cap on the (decompressed) body
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request, type RequestOptions } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { isBlockedAddress } from "./ip-ranges";

export type SafeFetchErrorCode =
  | "invalid_url"
  | "not_https"
  | "blocked_address"
  | "dns_failed"
  | "too_large"
  | "timeout"
  | "too_many_redirects"
  | "network";

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export type SafeFetchOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string | Buffer;
  maxBytes?: number; // default 5 MB
  timeoutMs?: number; // default 10 s, whole request incl. redirects
  maxRedirects?: number; // default 3
  /** Test seam: replaces DNS resolution. */
  resolve?: (hostname: string) => Promise<LookupAddress[]>;
};

export type SafeFetchResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  url: string; // final URL after redirects
  text(): string;
};

const DEFAULTS = { maxBytes: 5 * 1024 * 1024, timeoutMs: 10_000, maxRedirects: 3 };

const defaultResolve = (hostname: string) =>
  new Promise<LookupAddress[]>((resolve, reject) =>
    dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))),
  );

/** Validate a URL before any network activity. Exported for tests and for form validation. */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError("invalid_url", "That doesn't look like a web address. Check it starts with https://.");
  }
  if (url.protocol !== "https:") {
    throw new SafeFetchError("not_https", "Only secure (https://) addresses are allowed.");
  }
  if (url.username || url.password) {
    throw new SafeFetchError("invalid_url", "Remove the username and password from the address.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new SafeFetchError("blocked_address", "That address points to a private network, which isn't allowed.");
  }
  if (isIP(host) && isBlockedAddress(host)) {
    throw new SafeFetchError("blocked_address", "That address points to a private network, which isn't allowed.");
  }
  return url;
}

/**
 * Validate an API base URL at save time: https, no credentials/query/fragment,
 * and every DNS record public. (safeFetch re-checks at connect time on every call.)
 */
export async function assertPublicBaseUrl(
  raw: string,
  resolve: NonNullable<SafeFetchOptions["resolve"]> = defaultResolve,
): Promise<string> {
  const url = assertSafeUrl(raw.trim());
  if (url.search || url.hash) {
    throw new SafeFetchError("invalid_url", "Use the server address without anything after ? or #.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!isIP(host)) {
    let addresses: LookupAddress[];
    try {
      addresses = await resolve(host);
    } catch {
      throw new SafeFetchError("dns_failed", `Couldn't find ${host}. Check the address is spelled right.`);
    }
    if (addresses.length === 0) throw new SafeFetchError("dns_failed", `Couldn't find ${host}.`);
    if (addresses.some((a) => isBlockedAddress(a.address))) {
      throw new SafeFetchError("blocked_address", "That address points to a private network, which isn't allowed.");
    }
  }
  return url.toString().replace(/\/+$/, "");
}

function guardedLookup(resolve: NonNullable<SafeFetchOptions["resolve"]>): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0) {
          return callback(new SafeFetchError("dns_failed", `Couldn't find ${hostname}.`), "", 4);
        }
        // Refuse if ANY record is private: a mixed answer is a classic rebinding trick.
        if (addresses.some((a) => isBlockedAddress(a.address))) {
          return callback(
            new SafeFetchError("blocked_address", "That address points to a private network, which isn't allowed."),
            "",
            4,
          );
        }
        if (options && typeof options === "object" && options.all) {
          return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
        }
        callback(null, addresses[0].address, addresses[0].family);
      },
      () =>
        callback(new SafeFetchError("dns_failed", `Couldn't find ${hostname}. Check the address is spelled right.`), "", 4),
    );
  };
}

function decode(stream: Readable, encoding: string | undefined): Readable {
  switch ((encoding ?? "").toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return stream.pipe(createGunzip());
    case "br":
      return stream.pipe(createBrotliDecompress());
    case "deflate":
      return stream.pipe(createInflate());
    default:
      return stream;
  }
}

function once(
  url: URL,
  opts: Required<Pick<SafeFetchOptions, "maxBytes">> & SafeFetchOptions,
  signal: AbortSignal,
): Promise<{ status: number; headers: SafeFetchResponse["headers"]; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const reqOpts: RequestOptions = {
      method: opts.method ?? "GET",
      headers: { "accept-encoding": "gzip, br, deflate", "user-agent": "BYOMCP/0.1", ...opts.headers },
      lookup: guardedLookup(opts.resolve ?? defaultResolve),
      signal,
    };
    const req = request(url, reqOpts, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume(); // redirect bodies are ignored
        return resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
      }
      const declared = Number(res.headers["content-length"]);
      if (Number.isFinite(declared) && declared > opts.maxBytes) {
        res.destroy();
        return reject(tooLarge(opts.maxBytes));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      const body = decode(res, res.headers["content-encoding"] as string | undefined);
      body.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > opts.maxBytes) {
          res.destroy();
          body.destroy();
          reject(tooLarge(opts.maxBytes));
          return;
        }
        chunks.push(chunk);
      });
      body.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      body.on("error", (err) => reject(asSafeError(err)));
    });
    req.on("error", (err) => reject(asSafeError(err)));
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

function tooLarge(max: number) {
  return new SafeFetchError("too_large", `The response is larger than ${Math.round(max / 1024 / 1024)} MB.`);
}

function asSafeError(err: unknown): SafeFetchError {
  if (err instanceof SafeFetchError) return err;
  const e = err as NodeJS.ErrnoException & { cause?: unknown };
  if (e?.cause instanceof SafeFetchError) return e.cause;
  if (e?.name === "AbortError") return new SafeFetchError("timeout", "The site took too long to respond.");
  return new SafeFetchError("network", `Couldn't reach the site (${e?.code ?? e?.message ?? "network error"}).`);
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const opts = { ...DEFAULTS, ...options };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    let url = assertSafeUrl(rawUrl);
    let method = opts.method ?? "GET";
    let body = opts.body;
    for (let hop = 0; ; hop++) {
      const res = await once(url, { ...opts, method, body }, controller.signal);
      const location = res.headers.location;
      if (res.status >= 300 && res.status < 400 && typeof location === "string") {
        if (hop >= opts.maxRedirects) {
          throw new SafeFetchError("too_many_redirects", "The address redirected too many times.");
        }
        const next = assertSafeUrl(new URL(location, url).toString());
        if (next.origin !== url.origin) {
          // Never carry credentials or a request body to another host.
          opts.headers = Object.fromEntries(
            Object.entries(opts.headers ?? {}).filter(([k]) => !/^(authorization|cookie|proxy-authorization|x-api-key|api-key)$/i.test(k)),
          );
          if (method !== "GET") {
            method = "GET";
            body = undefined;
          }
        }
        url = next;
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method !== "GET")) {
          method = "GET";
          body = undefined;
        }
        continue;
      }
      const finalUrl = url.toString();
      return { ...res, url: finalUrl, text: () => res.body.toString("utf8") };
    }
  } catch (err) {
    throw asSafeError(err);
  } finally {
    clearTimeout(timer);
  }
}
