/**
 * Makes the trimmed OpenAPI files that BYOMCP serves for apps whose official
 * file is over (or right at) the 5 MB import limit (Stripe, Mailchimp,
 * Instantly), or only exists inside the vendor's docs page (Flodesk, whose
 * Redoc page embeds its official spec but offers no download link).
 *
 *   node scripts/trim-spec.mts
 *
 * Keeps only the listed operations and the components they reference. GET
 * response bodies are dropped (the importer only reads POST responses), which
 * is most of the size. Output: public/specs/<app>.json, served at
 * https://byomcp.vercel.app/specs/<app>.json and imported like any other link.
 */
import { mkdirSync, writeFileSync } from "node:fs";

type J = Record<string, unknown>;

const TRIMS: { app: string; url: string; keep: RegExp; note: string; redocPage?: boolean }[] = [
  {
    app: "stripe",
    url: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    note: "Stripe's official OpenAPI file, trimmed by BYOMCP to common reads (customers, payments, invoices, subscriptions, catalog, balance, refunds, payouts, disputes).",
    keep: /^GET \/v1\/(customers|customers\/search|customers\/\{customer\}|charges|charges\/\{charge\}|payment_intents|payment_intents\/\{intent\}|invoices|invoices\/\{invoice\}|subscriptions|subscriptions\/\{subscription_exposed_id\}|products|products\/\{id\}|prices|balance|balance_transactions|refunds|refunds\/\{refund\}|payouts|disputes)$/,
  },
  {
    app: "mailchimp",
    url: "https://raw.githubusercontent.com/mailchimp/mailchimp-client-lib-codegen/main/spec/marketing.json",
    note: "Mailchimp's official Marketing API file, trimmed by BYOMCP to audiences, members, campaigns and reports.",
    keep: /^(GET \/ping|GET \/lists|GET \/lists\/\{list_id\}|GET \/lists\/\{list_id\}\/members|GET \/lists\/\{list_id\}\/members\/\{subscriber_hash\}|POST \/lists\/\{list_id\}\/members|PATCH \/lists\/\{list_id\}\/members\/\{subscriber_hash\}|GET \/search-members|GET \/campaigns|GET \/campaigns\/\{campaign_id\}|GET \/reports|GET \/reports\/\{campaign_id\})$/,
  },
  {
    app: "instantly",
    url: "https://api.instantly.ai/openapi/api_v2.json",
    note: "Instantly's official API v2 file, trimmed by BYOMCP to campaigns, leads, lead lists, emails and accounts (no deletes).",
    keep: /^(GET|POST|PATCH) \/api\/v2\/(campaigns|leads|lead-lists|emails|accounts)(\/[^ ]*)?$/,
  },
  {
    app: "flodesk",
    url: "https://developers.flodesk.com/",
    redocPage: true,
    note: "Flodesk's official API description, taken from its docs page (which embeds it) by BYOMCP, unchanged apart from dropping GET response bodies.",
    keep: /./,
  },
];

/** The spec a Redoc page embeds in `const __redoc_state = {...};`. */
function fromRedocPage(html: string): J {
  const line = html.split(/\r?\n/).find((l) => l.includes("__redoc_state = {"));
  if (!line) throw new Error("No embedded spec found on the page.");
  const json = line.slice(line.indexOf("{")).trim().replace(/;$/, "");
  return ((JSON.parse(json) as J).spec as J).data as J;
}

const METHODS = ["get", "post", "put", "patch", "delete"];

function refs(node: unknown, out: Set<string>) {
  if (Array.isArray(node)) node.forEach((n) => refs(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string" && v.startsWith("#/")) out.add(v);
      else refs(v, out);
    }
  }
}

const resolve = (doc: J, ref: string) => ref.slice(2).split("/").reduce<unknown>((n, k) => (n as J | undefined)?.[k.replace(/~1/g, "/").replace(/~0/g, "~")], doc);

for (const t of TRIMS) {
  const res = await fetch(t.url);
  const doc = t.redocPage ? fromRedocPage(await res.text()) : ((await res.json()) as J);
  const paths: J = {};
  let kept = 0;
  for (const [path, item] of Object.entries(doc.paths as J)) {
    const ops = Object.fromEntries(
      Object.entries(item as J).filter(([m]) => !METHODS.includes(m) || t.keep.test(`${m.toUpperCase()} ${path}`)),
    );
    const methods = Object.keys(ops).filter((m) => METHODS.includes(m));
    if (!methods.length) continue;
    for (const m of methods) {
      kept++;
      if (m === "get") ops[m] = { ...(ops[m] as J), responses: { "200": { description: "OK" } } };
    }
    paths[path] = ops;
  }

  // Keep every component reachable from the kept operations (and security schemes).
  const wanted = new Set<string>();
  refs(paths, wanted);
  const seen = new Set<string>();
  const queue = [...wanted];
  while (queue.length) {
    const ref = queue.pop()!;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const more = new Set<string>();
    refs(resolve(doc, ref), more);
    queue.push(...more);
  }
  const pick = (section: string, group?: string) => {
    const src = (group ? (doc[section] as J | undefined)?.[group] : doc[section]) as J | undefined;
    if (!src) return undefined;
    const prefix = group ? `#/${section}/${group}/` : `#/${section}/`;
    return Object.fromEntries(Object.entries(src).filter(([name]) => seen.has(prefix + name.replace(/~/g, "~0").replace(/\//g, "~1"))));
  };

  const out: J = { ...doc, paths };
  out.info = { ...(doc.info as J), description: t.note };
  if (doc.components) {
    const comps: J = {};
    for (const group of Object.keys(doc.components as J)) {
      comps[group] = group === "securitySchemes" ? (doc.components as J)[group] : pick("components", group);
    }
    out.components = comps;
  }
  for (const section of ["definitions", "parameters", "responses"]) if (doc[section]) out[section] = pick(section);
  delete out["x-stripeSpecFilename"];
  delete out["x-webhooks"]; // incoming webhooks aren't actions, and they'd point at pruned schemas
  delete out.webhooks;

  mkdirSync("public/specs", { recursive: true });
  const text = JSON.stringify(out);
  writeFileSync(`public/specs/${t.app}.json`, text);
  console.log(`${t.app}: ${kept} operations, ${(text.length / 1024).toFixed(0)} KB`);
}
