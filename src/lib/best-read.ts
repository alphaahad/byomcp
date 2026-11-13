import type { JsonSchemaObject, RiskTier } from "./ir";
import { toolInputPlan } from "./tool-input";

type Candidate = {
  id: string;
  title: string;
  risk: RiskTier;
  enabled: boolean;
  params: { path: JsonSchemaObject; query: JsonSchemaObject; headers: JsonSchemaObject; body?: JsonSchemaObject };
};

type Prop = { default?: unknown; enum?: unknown[] };

/**
 * How easy a read is to run with no knowledge of the app: lists and searches
 * score higher; every required input without a default or a fixed list of
 * values makes it much less runnable.
 */
export function readScore(a: Candidate): number {
  const plan = toolInputPlan(a.params);
  const props = plan.schema.properties as Record<string, Prop>;
  const unknown = (plan.schema.required ?? []).filter((r) => props[r]?.default === undefined && !props[r]?.enum?.length).length;
  return (/^(list|find|search|get all|show all)/i.test(a.title) ? 2 : 0) + (a.enabled ? 1 : 0) - unknown * 5;
}

/** Inputs that fill every required field from its default or first allowed value; null if some required field can't be filled. */
export function autoInputs(a: Candidate): Record<string, unknown> | null {
  const plan = toolInputPlan(a.params);
  const props = plan.schema.properties as Record<string, Prop>;
  const input: Record<string, unknown> = {};
  for (const name of plan.schema.required ?? []) {
    const p = props[name];
    if (p?.default !== undefined) input[name] = p.default;
    else if (p?.enum?.length) input[name] = p.enum[0];
    else return null;
  }
  return input;
}

/** The read a newcomer (or an automatic check) can run straight away, or null if none can run without inputs. */
export function bestRead<T extends Candidate>(actions: T[], opts: { onlyEnabled?: boolean } = {}): T | null {
  const reads = actions.filter((a) => a.risk === "read" && (!opts.onlyEnabled || a.enabled));
  const ranked = [...reads].sort((x, y) => readScore(y) - readScore(x));
  return ranked.find((a) => autoInputs(a) !== null) ?? null;
}
