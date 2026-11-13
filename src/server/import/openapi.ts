import "server-only";
/**
 * OpenAPI / Swagger → Action IR. Deterministic: no LLM, no network.
 * SPEC 7.4 "OpenAPI path". Every action is validated against ActionIRSchema;
 * anything that can't be mapped is reported in `skipped`, never silently dropped.
 *
 * Security: only internal `#/...` refs are followed. External refs (URLs, files)
 * are never fetched or read; they become an opaque placeholder schema.
 */
import SwaggerParser from "@apidevtools/swagger-parser";
import { parse as parseYaml } from "yaml";
import {
  ActionIRSchema,
  classifyRisk,
  dedupeKeys,
  pathPlaceholders,
  toActionKey,
  type ActionIR,
  type HttpMethod,
  type JsonSchemaObject,
} from "@/lib/ir";
import type { DetectedAuth, DetectedConfig, SkippedOperation } from "@/lib/import-types";
import { FORM_FLAG } from "@/lib/tool-input";

/* Types --------------------------------------------------------------- */

export type { DetectedAuth, DetectedConfig, SkippedOperation };

export type OpenApiImportResult = {
  actions: ActionIR[];
  detected: DetectedConfig;
  skipped: SkippedOperation[];
};

export class OpenApiImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenApiImportError";
  }
}

export const MAX_SPEC_BYTES = 5 * 1024 * 1024;
export const MAX_OPERATIONS = 1000;
const MAX_SCHEMA_DEPTH = 8;

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const METHODS: Record<string, HttpMethod> = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
};
const IGNORED_METHODS = new Set(["head", "options", "trace"]);
const IGNORED_HEADERS = new Set(["authorization", "content-type", "accept", "content-length", "user-agent", "cookie"]);

/* Parsing --------------------------------------------------------------- */

/** Parse JSON or YAML text into a spec object. Throws OpenApiImportError with a plain message. */
export function parseSpecText(text: string): J {
  if (Buffer.byteLength(text, "utf8") > MAX_SPEC_BYTES) {
    throw new OpenApiImportError("That file is larger than 5 MB. Try the spec for just the part of the API you need.");
  }
  let doc: unknown;
  try {
    doc = parseYaml(text, { maxAliasCount: 100 }); // JSON is valid YAML; alias cap blocks "billion laughs"
  } catch {
    throw new OpenApiImportError("We couldn't read that file. It should be an OpenAPI or Swagger file in JSON or YAML.");
  }
  if (!isObj(doc) || !(str(doc.openapi) || str(doc.swagger))) {
    throw new OpenApiImportError(
      "This doesn't look like an OpenAPI or Swagger file (no \"openapi\" or \"swagger\" version at the top). If it's a docs page, use the docs link option instead.",
    );
  }
  return doc;
}

const PARSER_OPTIONS = {
  resolve: { external: false, file: false, http: false },
  dereference: { circular: "ignore" as const },
};

async function dereference(doc: J, warnings: string[]): Promise<J> {
  try {
    return (await SwaggerParser.validate(structuredClone(doc) as never, PARSER_OPTIONS as never)) as unknown as J;
  } catch (err) {
    // Many real-world specs fail strict validation but are still usable.
    try {
      const deref = (await SwaggerParser.dereference(structuredClone(doc) as never, {
        ...PARSER_OPTIONS,
        validate: { schema: false, spec: false },
      } as never)) as unknown as J;
      warnings.push(`The spec has validation problems, so some actions may need a closer look (${firstLine(err)}).`);
      return deref;
    } catch (err2) {
      throw new OpenApiImportError(`We couldn't read this spec: ${firstLine(err2)}`);
    }
  }
}

function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n")[0].slice(0, 200);
}

/* Schemas --------------------------------------------------------------- */

/**
 * Make a schema self-contained and finite: copy, cut cycles and depth,
 * replace leftover $refs (circular or external) with a placeholder,
 * translate OpenAPI 3.0 `nullable`, and optionally drop readOnly properties.
 */
export function cleanSchema(schema: unknown, opts: { dropReadOnly?: boolean; root?: J } = {}): J {
  const walk = (node: unknown, depth: number, ancestors: Set<unknown>): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, depth, ancestors));
    if (!isObj(node)) return node;
    if (typeof node.$ref === "string") {
      // Internal refs left behind by circular dereferencing: resolve once per chain.
      // External refs (URLs, files) are never followed.
      const target = opts.root && node.$ref.startsWith("#/") ? resolvePointer(opts.root, node.$ref) : undefined;
      if (!isObj(target) || ancestors.has(node.$ref) || ancestors.has(target)) return NESTED;
      return walk(target, depth, new Set(ancestors).add(node.$ref));
    }
    if (ancestors.has(node) || depth > MAX_SCHEMA_DEPTH) return NESTED;
    const next = new Set(ancestors).add(node);
    const out: J = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "xml" || k === "externalDocs" || k === "discriminator") continue;
      if (k === "properties" && isObj(v)) {
        const props: J = {};
        for (const [name, prop] of Object.entries(v)) {
          if (opts.dropReadOnly && isObj(prop) && prop.readOnly === true) continue;
          props[name] = walk(prop, depth + 1, next);
        }
        out.properties = props;
        continue;
      }
      out[k] = walk(v, depth + 1, next);
    }
    if (opts.dropReadOnly && Array.isArray(out.required) && isObj(out.properties)) {
      const kept = out.properties;
      out.required = (out.required as unknown[]).filter((r) => typeof r === "string" && r in kept);
      if ((out.required as unknown[]).length === 0) delete out.required;
    }
    if (out.nullable === true) {
      delete out.nullable;
      if (typeof out.type === "string") out.type = [out.type, "null"];
    }
    return out;
  };
  const result = walk(schema, 0, new Set());
  return isObj(result) ? result : {};
}

const NESTED = { description: "Nested data. See the API docs for its shape." } as const;

function resolvePointer(root: J, pointer: string): unknown {
  let cur: unknown = root;
  for (const raw of pointer.slice(2).split("/")) {
    const key = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObj(cur) || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

const emptyObj = (): JsonSchemaObject => ({ type: "object", properties: {} });

/* Mapping helpers ----------------------------------------------------- */

type Param = { name: string; in: string; required?: boolean; description?: string; schema?: unknown } & J;

function mergeParams(pathLevel: unknown[], opLevel: unknown[]): Param[] {
  const byKey = new Map<string, Param>();
  for (const p of [...pathLevel, ...opLevel]) {
    if (isObj(p) && typeof p.name === "string" && typeof p.in === "string") {
      byKey.set(`${p.in}:${p.name}`, p as Param);
    }
  }
  return [...byKey.values()];
}

/** Swagger 2 params carry the schema inline (type/format/items/enum); 3.x use `schema`. */
/** The only value a schema allows (const, or a one-item enum), if it has exactly one. */
export function fixedValue(schema: J): string | number | boolean | undefined {
  const only = "const" in schema ? schema.const : Array.isArray(schema.enum) && schema.enum.length === 1 ? schema.enum[0] : undefined;
  return typeof only === "string" || typeof only === "number" || typeof only === "boolean" ? only : undefined;
}

function paramSchema(p: Param, root?: J): J {
  const base = isObj(p.schema)
    ? cleanSchema(p.schema, { root })
    : cleanSchema(
        Object.fromEntries(
          Object.entries(p).filter(([k]) =>
            ["type", "format", "items", "enum", "default", "minimum", "maximum", "pattern", "maxLength"].includes(k),
          ),
        ),
        { root },
      );
  if (!base.type && !base.enum && !base.oneOf && !base.anyOf) base.type = "string";
  const description = str(p.description);
  return description ? { ...base, description } : base;
}

function addProp(target: JsonSchemaObject, name: string, schema: J, required: boolean) {
  target.properties[name] = schema;
  if (required) target.required = [...(target.required ?? []), name];
}

const PREFERRED_MEDIA = ["application/json", "application/x-www-form-urlencoded", "multipart/form-data"];

/** Body as a JSON Schema object. Non-object bodies (arrays, strings) are wrapped under `body`. */
function bodySchema(op: J, params: Param[], root: J): JsonSchemaObject | undefined {
  // OpenAPI 3.x
  if (isObj(op.requestBody) && isObj(op.requestBody.content)) {
    const content = op.requestBody.content;
    const media =
      PREFERRED_MEDIA.find((m) => m in content) ?? Object.keys(content).find((m) => /json/i.test(m)) ?? Object.keys(content)[0];
    const schema = media && isObj(content[media]) ? (content[media] as J).schema : undefined;
    const body = wrapBody(schema, op.requestBody.required === true, root);
    return media === "application/x-www-form-urlencoded" ? asForm(body) : body;
  }
  // Swagger 2
  const bodyParam = params.find((p) => p.in === "body");
  if (bodyParam) return wrapBody(bodyParam.schema, bodyParam.required === true, root);
  const formParams = params.filter((p) => p.in === "formData");
  if (formParams.length) {
    const obj = emptyObj();
    for (const p of formParams) addProp(obj, p.name, paramSchema(p, root), p.required === true);
    return asForm(obj);
  }
  return undefined;
}

/** The executor sends a body marked like this as form fields (a=1&b=2), not JSON. */
function asForm(body: JsonSchemaObject | undefined): JsonSchemaObject | undefined {
  if (!body || (body as J)["x-byomcp-wrapped"] === true) return body;
  return { ...body, [FORM_FLAG]: true } as JsonSchemaObject;
}

function wrapBody(schema: unknown, required: boolean, root: J): JsonSchemaObject | undefined {
  if (!isObj(schema)) return undefined;
  const cleaned = cleanSchema(schema, { dropReadOnly: true, root });
  const isObjectSchema = cleaned.type === "object" || (cleaned.type === undefined && isObj(cleaned.properties));
  if (isObjectSchema) {
    return { ...cleaned, type: "object", properties: isObj(cleaned.properties) ? cleaned.properties : {} } as JsonSchemaObject;
  }
  // The executor sends `body` as the whole request body when this marker is set.
  return {
    type: "object",
    properties: { body: cleaned },
    ...(required ? { required: ["body"] } : {}),
    "x-byomcp-wrapped": true,
  };
}

/* Titles and grouping ---------------------------------------------------- */

const isParamSeg = (s: string) => /^\{.+\}$/.test(s);
const isNoiseSeg = (s: string) => /^(api|v\d+(\.\d+)*|rest)$/i.test(s);
const words = (s: string) => s.replace(/[-_.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();
function singular(w: string) {
  if (/ies$/.test(w)) return w.replace(/ies$/, "y");
  if (/(ss|us)$/.test(w)) return w;
  if (/(ch|sh|x|ses)$/.test(w) && w.endsWith("es")) return w.slice(0, -2);
  return w.replace(/s$/, "");
}
const article = (w: string) => (/^[aeiou]/.test(w) ? "an" : "a");
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "GET /tickets/{id}" → "Get a ticket"; "POST /subscriptions/{id}/cancel" → "Cancel subscription". */
export function humanTitle(method: HttpMethod, path: string): string {
  const segs = path.split("/").filter((s) => s && !isNoiseSeg(s));
  if (segs.length === 0) return `${sentence(method.toLowerCase())} root`;
  const last = segs[segs.length - 1];
  const lastIsParam = isParamSeg(last);
  const lastNoun = [...segs].reverse().find((s) => !isParamSeg(s)) ?? "item";
  const noun = words(lastNoun);
  const one = singular(noun);

  // Action sub-resource: POST /things/{id}/cancel
  if (!lastIsParam && segs.length >= 2 && isParamSeg(segs[segs.length - 2]) && method !== "GET") {
    const resource = singular(words([...segs.slice(0, -2)].reverse().find((s) => !isParamSeg(s)) ?? "item"));
    return sentence(`${noun} ${resource}`);
  }
  switch (method) {
    case "GET":
      return lastIsParam ? sentence(`get ${article(one)} ${one}`) : sentence(`list ${noun}`);
    case "POST":
      return sentence(`create ${article(one)} ${one}`);
    case "PUT":
    case "PATCH":
      return sentence(`update ${article(one)} ${one}`);
    case "DELETE":
      return sentence(`delete ${article(one)} ${one}`);
  }
}

function resourceFor(op: J, path: string): string {
  const tag = str(arr(op.tags)[0]);
  const seg = path.split("/").find((s) => s && !isParamSeg(s) && !isNoiseSeg(s));
  const raw = tag ?? (seg ? words(seg) : "General");
  return sentence(raw).slice(0, 60);
}

function clip(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const stop = cut.lastIndexOf(". ");
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}

function detectPagination(query: JsonSchemaObject): ActionIR["pagination"] {
  const names = Object.keys(query.properties).map((n) => n.toLowerCase());
  if (names.some((n) => ["cursor", "starting_after", "after", "next", "page_token", "pagetoken", "next_cursor"].includes(n))) {
    return { style: "cursor" };
  }
  if (names.includes("page")) return { style: "page" };
  if (names.includes("offset")) return { style: "offset" };
  return undefined;
}

/** A create that returns an object with `id`: a 2xx without `id` means it didn't really work (SPEC 7.5). */
function detectSuccessCheck(method: HttpMethod, op: J): ActionIR["successCheck"] {
  if (method !== "POST" || !isObj(op.responses)) return undefined;
  for (const [code, res] of Object.entries(op.responses)) {
    if (!/^2\d\d$/.test(code) || !isObj(res)) continue;
    const schema = isObj(res.content)
      ? (Object.values(res.content).find(isObj) as J | undefined)?.schema
      : res.schema; // Swagger 2
    if (isObj(schema) && isObj(schema.properties) && "id" in schema.properties) return { field: "id" };
  }
  return undefined;
}

/* Detection: base URL and auth ----------------------------------------- */

type BaseUrlVars = NonNullable<DetectedConfig["baseUrlVariables"]>;

function detectBaseUrls(
  doc: J,
  sourceUrl: string | undefined,
  warnings: string[],
  variables: BaseUrlVars = {},
): string[] {
  const out: string[] = [];
  const push = (raw: string) => {
    // Hostname placeholders ({subdomain}) are kept; validate with a stand-in value.
    const probe = raw.replace(/\{([^}]+)\}/g, "placeholder");
    let url: URL;
    try {
      url = new URL(probe, sourceUrl);
    } catch {
      warnings.push(`Ignored a server address we couldn't read: ${raw}`);
      return;
    }
    if (url.protocol !== "https:") {
      warnings.push(`Ignored a non-secure server address: ${url.origin}`);
      return;
    }
    let clean = url.toString().replace(/\/+$/, "");
    if (probe !== raw) clean = /^[a-z]+:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : clean;
    if (!out.includes(clean)) out.push(clean);
  };

  if (str(doc.swagger)) {
    const host = str(doc.host);
    const basePath = str(doc.basePath) ?? "";
    const schemes = arr(doc.schemes).filter((s): s is string => typeof s === "string");
    if (host) {
      if (schemes.length === 0 || schemes.includes("https")) push(`https://${host}${basePath}`);
      else warnings.push(`The spec only lists a non-secure (http) server for ${host}.`);
    } else if (sourceUrl) {
      push(new URL(basePath || "/", sourceUrl).toString());
    }
    return out;
  }

  for (const server of arr(doc.servers)) {
    if (!isObj(server) || !str(server.url)) continue;
    let url = str(server.url)!;
    const vars = isObj(server.variables) ? server.variables : {};
    const hostEnd = url.indexOf("/", url.indexOf("://") + 3);
    url = url.replace(/\{([^}]+)\}/g, (m, name: string, offset: number) => {
      const v = vars[name];
      if (!isObj(v)) return m;
      const values = arr(v.enum).filter((e): e is string => typeof e === "string");
      const inHost = url.includes("://") && (hostEnd < 0 || offset < hostEnd);
      // Per-customer host parts ({subdomain}) stay as placeholders, unless only one value is allowed.
      const sampleDefault =
        typeof v.default !== "string" || /^(example|sample|demo|test|acme|your.*|my.*|company|subdomain|tenant|instance|account|domain|placeholder)$/i.test(v.default);
      // A real default (e.g. {domain} = "zendesk") is used; a sample one ("example") becomes a question for the user.
      if (inHost && values.length !== 1 && (values.length > 1 || sampleDefault)) {
        variables[name] = {
          ...(values.length ? { enum: values } : {}),
          ...(typeof v.default === "string" && values.length ? { default: v.default } : {}),
          ...(str(v.description) ? { description: str(v.description)!.slice(0, 200) } : {}),
        };
        return m;
      }
      if (values.length === 1) return values[0];
      return typeof v.default === "string" ? v.default : m;
    });
    if (/\{[^}]+\}/.test(url.replace(new RegExp(`\\{(${Object.keys(variables).join("|") || "$^"})\\}`, "g"), ""))) {
      warnings.push(`A server address has a placeholder we couldn't fill: ${url}`);
      continue;
    }
    if (!/^[a-z]+:\/\//i.test(url) && !sourceUrl) {
      warnings.push(`The server address "${url}" is relative, so you'll need to enter the full address.`);
      continue;
    }
    push(url);
  }
  return out;
}

function mapScheme(s: J): DetectedAuth {
  const type = str(s.type)?.toLowerCase();
  if (type === "apikey") {
    const where = str(s.in);
    const name = str(s.name);
    if ((where === "header" || where === "query") && name) return { type: "api_key", in: where, name };
    return { type: "unsupported", scheme: `API key in ${where ?? "unknown place"}` };
  }
  if (type === "http") {
    const scheme = str(s.scheme)?.toLowerCase();
    if (scheme === "bearer") return { type: "bearer" };
    if (scheme === "basic") return { type: "basic" };
    return { type: "unsupported", scheme: `HTTP ${scheme ?? "auth"}` };
  }
  if (type === "basic") return { type: "basic" }; // Swagger 2
  if (type === "oauth2") return { type: "unsupported", scheme: "OAuth 2.0" };
  if (type === "openidconnect") return { type: "unsupported", scheme: "OpenID Connect" };
  return { type: "unsupported", scheme: type ?? "unknown" };
}

function detectAuth(doc: J): DetectedAuth {
  const schemes: J =
    (isObj(doc.components) && isObj(doc.components.securitySchemes) && doc.components.securitySchemes) ||
    (isObj(doc.securityDefinitions) && doc.securityDefinitions) ||
    {};
  const names = Object.keys(schemes);
  if (names.length === 0) return { type: "none" };
  // Prefer schemes the spec says are used (top-level security), then any; prefer supported ones.
  const used = arr(doc.security).flatMap((req) => (isObj(req) ? Object.keys(req) : []));
  const ordered = [...used, ...names].filter((n, i, all) => all.indexOf(n) === i && isObj(schemes[n]));
  const mapped = ordered.map((n) => mapScheme(schemes[n] as J));
  return mapped.find((m) => m.type !== "unsupported") ?? mapped[0] ?? { type: "none" };
}

/* Main ------------------------------------------------------------------ */

export async function importOpenApi(rawDoc: J, opts: { sourceUrl?: string } = {}): Promise<OpenApiImportResult> {
  const warnings: string[] = [];
  const doc = await dereference(rawDoc, warnings);
  const info = isObj(doc.info) ? doc.info : {};
  const auth = detectAuth(doc);
  if (auth.type === "unsupported") {
    warnings.push(`This API uses ${auth.scheme}, which isn't supported yet. You can still connect it with an API key or token if the app offers one.`);
  }
  const authParam =
    auth.type === "api_key" ? `${auth.in}:${auth.name.toLowerCase()}` : undefined;

  const baseUrlVariables: BaseUrlVars = {};
  const baseUrlCandidates = detectBaseUrls(doc, opts.sourceUrl, warnings, baseUrlVariables);
  const skipped: SkippedOperation[] = [];
  const drafts: ActionIR[] = [];
  const paths = isObj(doc.paths) ? doc.paths : {};

  let count = 0;
  for (const [path, item] of Object.entries(paths)) {
    if (!isObj(item)) continue;
    for (const [m, opRaw] of Object.entries(item)) {
      const lower = m.toLowerCase();
      if (IGNORED_METHODS.has(lower)) {
        skipped.push({ method: m.toUpperCase(), path, reason: `${m.toUpperCase()} requests aren't supported` });
        continue;
      }
      const method = METHODS[lower];
      if (!method || !isObj(opRaw)) continue; // "parameters", "summary", vendor extensions
      if (++count > MAX_OPERATIONS) {
        throw new OpenApiImportError(
          `This spec has more than ${MAX_OPERATIONS} actions. Try a smaller spec for just the part of the API you need.`,
        );
      }
      const op = opRaw;
      const params = mergeParams(arr(item.parameters), arr(op.parameters));

      const pathParams = emptyObj();
      const query = emptyObj();
      const headers = emptyObj();
      for (const p of params) {
        const key = `${p.in}:${p.name.toLowerCase()}`;
        if (key === authParam) continue; // credentials are injected by the runtime, never asked of the model
        if (p.in === "path") addProp(pathParams, p.name, paramSchema(p, doc), true);
        else if (p.in === "query") addProp(query, p.name, paramSchema(p, doc), p.required === true);
        else if (p.in === "header" && !IGNORED_HEADERS.has(p.name.toLowerCase())) {
          // A header with one allowed value (e.g. Notion-Version) is filled in by the runtime, not asked for.
          const schema = paramSchema(p, doc);
          const fixed = fixedValue(schema);
          if (fixed !== undefined) schema.default = fixed;
          addProp(headers, p.name, schema, p.required === true && fixed === undefined);
        }
      }
      // A {placeholder} with no declared parameter is a spec bug; declare it so the action stays usable.
      for (const name of pathPlaceholders(path)) {
        if (!(name in pathParams.properties)) addProp(pathParams, name, { type: "string" }, true);
      }

      const summary = str(op.summary);
      const title = clip((summary ?? humanTitle(method, path)).replace(/\.$/, ""), 120);
      const description = clip(str(op.description) ?? summary ?? title, 500);
      const rawKey = str(op.operationId) ?? `${lower}_${path.replace(/\{([^}]+)\}/g, "by_$1")}`;
      const key = toActionKey(rawKey);
      const body = bodySchema(op, params, doc);

      drafts.push({
        key,
        title: op.deprecated === true ? `${title} (deprecated)`.slice(0, 120) : title,
        description,
        resource: resourceFor(op, path),
        method,
        path,
        params: { path: pathParams, query, headers, ...(body ? { body } : {}) },
        successCheck: detectSuccessCheck(method, op),
        pagination: detectPagination(query),
        risk: classifyRisk({ method, key, title, path }),
        evidence: "sourced",
        citation: {
          ...(opts.sourceUrl ? { url: opts.sourceUrl } : {}),
          quote: clip(`${method} ${path}${summary ? `: ${summary}` : ""}`, 500),
        },
        confidence: 1,
      });
    }
  }

  const keys = dedupeKeys(drafts.map((d) => d.key));
  const actions: ActionIR[] = [];
  drafts.forEach((draft, i) => {
    const parsed = ActionIRSchema.safeParse({ ...draft, key: keys[i] });
    if (parsed.success) actions.push(parsed.data);
    else skipped.push({ method: draft.method, path: draft.path, reason: parsed.error.issues[0]?.message ?? "invalid" });
  });

  if (actions.length === 0) {
    throw new OpenApiImportError(
      skipped.length
        ? "We read the spec but couldn't turn any of its operations into actions."
        : "This spec doesn't list any API operations (its \"paths\" section is empty).",
    );
  }

  return {
    actions,
    skipped,
    detected: {
      apiTitle: str(info.title) ?? "Untitled API",
      apiVersion: str(info.version),
      baseUrl: baseUrlCandidates[0],
      baseUrlCandidates,
      ...(Object.keys(baseUrlVariables).length ? { baseUrlVariables } : {}),
      auth,
      warnings,
    },
  };
}
