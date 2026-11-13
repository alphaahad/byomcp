/**
 * The input shape a tool exposes (to "Try it" and to MCP clients) and how it
 * maps back to path / query / header / body. Inputs are FLAT, because that's
 * easiest for a model to fill in. If a body field's name clashes with a path/query/header
 * parameter, or the body isn't an object, the whole body goes under `body`.
 */
import type { ActionIR, JsonSchemaObject } from "./ir";

type Params = ActionIR["params"];
type Where = "path" | "query" | "header" | "body" | "bodyWhole";

export type ToolInputPlan = {
  schema: JsonSchemaObject & { additionalProperties: false };
  where: Record<string, Where>;
};

const isWrapped = (b?: JsonSchemaObject) => !!b && (b as Record<string, unknown>)["x-byomcp-wrapped"] === true;

/** Marks a request body the app expects as form fields (application/x-www-form-urlencoded). */
export const FORM_FLAG = "x-byomcp-form";

/** Marks a path parameter that holds the app's key (filled by the runtime from the saved secret). */
export const CREDENTIAL_FLAG = "x-byomcp-credential";
export const isCredentialParam = (schema: unknown) =>
  !!schema && typeof schema === "object" && (schema as Record<string, unknown>)[CREDENTIAL_FLAG] === true;

export function toolInputPlan(params: Params): ToolInputPlan {
  const properties: Record<string, unknown> = {};
  const required = new Set<string>();
  const where: Record<string, Where> = {};

  const add = (from: JsonSchemaObject, w: Where) => {
    const hidden = new Set<string>();
    for (const [name, schema] of Object.entries(from.properties)) {
      // A key kept in the path is never shown to (or asked of) the AI employee.
      if (isCredentialParam(schema)) {
        hidden.add(name);
        continue;
      }
      properties[name] = schema;
      where[name] = w;
    }
    for (const r of from.required ?? []) if (!hidden.has(r)) required.add(r);
  };
  add(params.path, "path");
  add(params.query, "query");
  add(params.headers, "header");

  const body = params.body;
  if (body && Object.keys(body.properties).length > 0) {
    const clash = Object.keys(body.properties).some((n) => n in where);
    if (isWrapped(body)) {
      properties.body = body.properties.body;
      where.body = "bodyWhole";
      if (body.required?.includes("body")) required.add("body");
    } else if (clash) {
      const { properties: p, required: r, ...rest } = body;
      properties.body = { ...rest, type: "object", properties: p, ...(r?.length ? { required: r } : {}) };
      where.body = "bodyWhole";
      if (r?.length) required.add("body");
    } else {
      add(body, "body");
    }
  }

  return {
    schema: {
      type: "object",
      properties,
      ...(required.size ? { required: [...required] } : {}),
      additionalProperties: false,
    },
    where,
  };
}

export type SplitInput = {
  path: Record<string, unknown>;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  body?: unknown;
};

/** Route flat input back to request parts. Unknown keys are ignored (validation rejects them first). */
export function splitInput(plan: ToolInputPlan, input: Record<string, unknown>): SplitInput {
  const out: SplitInput = { path: {}, query: {}, headers: {} };
  const bodyFields: Record<string, unknown> = {};
  let hasBodyFields = false;
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    switch (plan.where[k]) {
      case "path":
        out.path[k] = v;
        break;
      case "query":
        out.query[k] = v;
        break;
      case "header":
        out.headers[k] = v;
        break;
      case "body":
        bodyFields[k] = v;
        hasBodyFields = true;
        break;
      case "bodyWhole":
        out.body = v;
        break;
    }
  }
  if (hasBodyFields) out.body = bodyFields;
  return out;
}
