# Decisions

What we chose, why, and what we rejected. Newest slice at the bottom.

## Product-level (from the spec)

- **AI at build time, deterministic at runtime.** The LLM reads docs once to draft actions; a human reviews; the MCP runtime executes stored definitions with no LLM calls. *Rejected:* an agent that reads docs and improvises calls at runtime (cost per call, unpredictable, hard to audit).
- **Generic runtime over generated code.** Every connector is rows in Postgres interpreted by one executor. *Rejected:* generating a TypeScript MCP server per connector (harder to review, version, secure and update; each one is new code to trust).
- **Evidence states (Tested / Sourced / Needs review) instead of a confidence score.** Users trust "here is the quote" and "we ran it" more than "87%". The extractor's confidence is stored but only used to pick "Needs review".

## Slice 0: scaffold

- **Next.js 16 with Cache Components on** (the scaffold default, and the default in the next major release). Pages read request data behind `<Suspense>`, which also gives us loading states for free. *Rejected:* turning it off to use the older caching model (less work now, a migration later).
- **`proxy.ts`, not `middleware.ts`.** Next 16 renamed the convention. The proxy gives an optimistic check only; server actions and route handlers call `requireSession()` again, as the Next docs recommend, so a matcher mistake can't open them.
- **Passcode gate as a stateless signed cookie.** HMAC-SHA256 with a key derived (HKDF) from `CREDENTIALS_ENCRYPTION_KEY`, and the passcode mixed into the salt, so changing `APP_PASSCODE` signs everyone out. No sessions table and no extra secret. *Rejected:* a session library like iron-session (a dependency for ~40 lines), a separate `SESSION_SECRET` (one more env var to get wrong).
- **`/api/mcp/*` is outside the gate.** MCP clients authenticate with per-connector endpoint tokens instead (slice 4).
- **Neon over HTTP (`drizzle-orm/neon-http`).** One round trip per query and no connection pool to leak on serverless. Multi-step writes (publish) use `db.batch()`, which runs as one transaction. *Rejected:* the WebSocket pool driver (interactive transactions we don't need yet).
- **Safety rules in the database, not just the UI.** Check constraints: destructive actions must require approval, and action keys must match `^[a-z][a-z0-9_]{0,63}$`. The executor checks too; the constraint is the last line of defence.
- **IR validated with Zod, JSON Schema kept loose.** We validate the parts we depend on (`type: object`, `properties`, `required`), and pass other JSON Schema keywords through untouched. The IR also refuses a risk lower than the HTTP verb implies (a POST can't be "read").
- **Risk escalation by name only for writes.** "Refund a payment" (POST) becomes destructive; "List archived tickets" (GET) stays a read. Whole-word matching, so "voidable" doesn't trigger "void".
- **Env validated on first use, not at import.** `next build` needs no secrets; a missing variable fails with a message naming it.
- **TypeScript 5.x, as pinned by `create-next-app`.** TypeScript 7 (the native compiler) is `latest` on npm but Next 16.4 scaffolds `^5`; we follow the framework.
- **Node 24 (`engines`), `@types/node` 24.** The scaffold's `@types/node@20` conflicted with vitest 5's peer range.
- **Migrations run through Drizzle's migrator over Neon HTTP (`scripts/migrate.mts`), not `drizzle-kit migrate`.** drizzle-kit picked Neon's WebSocket driver and hung; the HTTP migrator uses deps we already have and the same `drizzle.__drizzle_migrations` table. `drizzle-kit generate` is still used to write the SQL. Migrations use the direct (unpooled) Neon URL. *Rejected:* adding `pg` just for drizzle-kit.
- **Neon via the Vercel Marketplace.** `DATABASE_URL` is injected into Vercel automatically. Vercel never reveals sensitive values to `vercel env pull`, so local dev copies the URL from the Neon/Vercel dashboard by hand.
- **Vitest for unit tests.** Fast, ESM-native, no config beyond the `@` alias.

## Slice 1: OpenAPI import

- **`@apidevtools/swagger-parser` for parsing and `$ref` resolution.** Small (56 KB), mature, supports Swagger 2.0 and OpenAPI 3.0 to 3.1.2. Strict validation first; if a real-world spec fails validation we still import it and show a warning, because many published specs have small errors. *Rejected:* `@scalar/openapi-parser` (1.9 MB, still 0.x), `@readme/openapi-parser` (same job, larger).
- **External `$ref`s are never followed.** File and HTTP resolvers are switched off, so a spec can't make the server read local files or fetch other URLs. Leftover refs become a "Nested data" placeholder.
- **Circular schemas are resolved one level, then cut.** An `Employee` body keeps its fields; its `manager` (another Employee) becomes a placeholder. Every tool input schema is finite and self-contained, which MCP clients need.
- **Deterministic titles, no AI.** The spec's `summary` if present, else generated from method and path ("List tickets", "Get a ticket", "Cancel subscription"). OpenAPI imports cost $0 and the UI says so. *Rejected for now:* an LLM pass to polish titles (may come in slice 2 as an option, with its cost shown).
- **Credentials never become tool parameters.** The API-key header or query parameter named in the spec's security scheme is removed from every action's inputs; the runtime injects it.
- **Bodies that aren't objects are wrapped** under a `body` property with an `x-byomcp-wrapped` marker, because the IR and MCP tool inputs are objects. The executor unwraps it.
- **Create actions get a success check** when the spec says the response has an `id`: a 2xx without one will count as failed (the "200 isn't proof" rule from SPEC 7.5).
- **Base URL and auth are suggestions.** Stored in `connector_versions.detected_json`; the user confirms them when connecting (slice 3). Only https servers are offered.
- **One batch per import.** Connector, draft version, actions and the job record are inserted in one Neon batch (a single transaction), so a failure leaves nothing half-saved. IDs are generated in the app so rows can reference each other inside the batch.
- **SSRF guard built on `node:https` with a custom `lookup`.** Every resolved address is checked when the socket connects, so DNS rebinding can't slip past an earlier check; any private record in a DNS answer blocks the request; IP-literal hosts are checked up front because Node skips `lookup` for them; redirects are followed manually and re-checked. No new dependency. *Rejected:* checking the URL once and then calling `fetch` (classic rebinding hole).
- **Upload limit 4 MB, link limit 5 MB.** Server action bodies are raised app-wide to 4.5 MB (Vercel's own request cap); spec links are fetched server-side, so they can be a little larger.
- **Empty env values mean "not set".** `LLM_MODEL=` in `.env.local` used to fail validation; found by the integration test.
- **Integration test is opt-in** (`RUN_INTEGRATION=1 npx vitest run integration`): real fetch of a public spec, real Neon write, read-back, cleanup.

## Slice 2: AI import (docs link or pasted text)

- **Model: `gemini-3.5-flash-lite`, with `gemini-3.8-flash` as an optional fallback.** Picked by measurement, not memory: on 2026-11-13 3.8 Flash returned 503 "high demand" and 504 timeouts even on a one-line prompt, while 3.5 Flash-Lite answered in about 1 s. Flash-Lite is also cheaper ($0.30 / $2.50 per 1M tokens vs $0.75 / $3.75) and Google positions it for "simple data extraction", which is exactly this job. `LLM_FALLBACK_MODEL` (a comma-separated list, see "AI fallback on quota errors") is tried if the main model is overloaded or out of quota; the cost is priced on the model that actually answered. 2.5 models are closed to new keys.
- **Structured output via `responseJsonSchema`, kept flat.** The installed SDK documents it (not deprecated) and lists the JSON Schema keywords it supports. The model returns flat parameter lists; our code builds the JSON Schemas, so we never depend on the model writing valid nested schemas.
- **Thinking level LOW.** MINIMAL is rejected with a 400 by 3.8 Flash. Thinking tokens are billed as output, so less thinking is cheaper; extraction is reading, not reasoning.
- **The model proposes; code decides.** Risk, "on by default" and "needs approval" come from our rules on the method, path and title, never from the model. Extra fields the model adds (risk, evidence, enabled) are ignored. Tested by simulating a model that obeyed an injected instruction.
- **A citation counts only if it's really in the docs.** The quote must appear in the text we sent (ignoring case, whitespace, curly quotes and backticks). If not, or confidence is under 0.7, the action is "Needs review" with no citation. We never show a quote we couldn't find.
- **Doc text is fenced and treated as data.** It goes inside `<docs>` tags; anything in the docs that looks like those tags is neutralised so it can't close the fence; the system prompt says to ignore instructions inside.
- **Credentials never become inputs.** Parameters named like keys, tokens or Authorization are dropped from every action.
- **Resumable steps instead of one long background job.** Each step fetches up to 4 pages or runs up to 3 AI calls in parallel, so it stays far below any function time limit (I couldn't confirm Hobby's limit from the docs). The progress page drives the steps; a database lease (`lease_until`) makes two open tabs harmless. *Trade-off:* the import only advances while its page is open; the page says so. *Rejected:* `after()` background work (silently killed at the time limit), a queue service (another dependency and account).
- **Crawl: same docs section, neighbours first.** Links are followed only within the start page's section (e.g. `/reference/...`), starting from the start page's position in the sidebar and wrapping around. Starting at "Get employee" therefore reads the other employee endpoints first. Default 10 pages, up to 25; pages that redirect to one already read are skipped.
- **Small pages share an AI call.** Pages are packed into ~40k-character chunks (each segment keeps its URL for citations). BambooHR: 6 pages → 1 call.
- **HTML → text with `node-html-parser` and a small converter.** Keeps headings, code blocks and tables (where API facts live); drops nav, footers, scripts. A 740 KB BambooHR page becomes about 5 KB of text. *Rejected:* Readability + linkedom + turndown (three deps; Readability drops code and tables).
- **If the docs link an OpenAPI file, we say so** and offer to import that instead (free and more complete). If the link itself is an OpenAPI file, we stop and point to the OpenAPI option.
- **Doc text is kept only while importing.** Page text and chunk text are cleared when the import finishes or fails; results, tokens and cost stay for the record.
- **Measured on BambooHR (live):** 6 pages, 1 AI call, 7,421 tokens, $0.0040, 6 actions, all Sourced with exact quotes, risk classified correctly (delete = destructive). The base URL has a `{companyDomain}` placeholder, filled in when connecting (slice 3).

## Slice 3: Review, connect your account, Try it (+ design direction C)

- **Design: direction C, 90s system utility.** Platinum chrome, bevelled buttons, real title bars, group boxes, status bars; dark mode is a high-contrast scheme. Fonts via `next/font` (no new dependency): Silkscreen for window titles only, Atkinson Hyperlegible Next for everything else, Atkinson Hyperlegible Mono for code. Colour is never the only cue: risk and evidence are always a word plus a glyph (◇ Read, ✎ Write, ⚠ Destructive; ✓✓ Tested, ✓ Sourced, ? Needs review). The DESIGN.md green (#007A33) failed AA on platinum (3.56:1), so it's #005F27 (5.12:1); every text colour passes AA in both themes.
- **Credentials: AES-256-GCM with the connector id as associated data.** A fresh 96-bit IV per write; a ciphertext copied onto another connector fails to decrypt. The browser only ever gets a hint ("API key ending 3f9a"). Secrets are scrubbed from response previews and logs, including the base64 basic-auth header.
- **Base URL templates.** Docs like BambooHR's `https://{companyDomain}.bamboohr.com` get a field per placeholder; values are limited to hostname-safe characters so they can't change the URL's shape. At save time the URL must be https with no query or fragment, and every DNS record must be public; the guarded fetch re-checks on every call.
- **Flat tool inputs.** `{ id, status, subject }` rather than `{ path: {...}, body: {...} }`, because it's easier for models. One mapping (`src/lib/tool-input.ts`) routes each field; the body moves under `body` only if a name clashes or the body isn't an object. The MCP runtime will use the same mapping, so Try it and MCP calls build identical requests.
- **Executor rules.** Path values are URL-encoded (so `../admin` stays inside its segment); the final URL must stay on the confirmed origin and base path; tool-supplied headers can't be Authorization/Cookie/Host/etc. and can't contain line breaks; credentials are added last so nothing can override them; redirects are not followed (a redirect is reported, not chased). Inputs are validated with `ajv` before any request.
- **Retries only for reads.** GETs retry up to twice on 429/5xx/timeouts (honouring Retry-After up to 5 s). Writes are never retried automatically, because a retried POST can create duplicates.
- **"200 isn't proof."** A 2xx whose success check fails (e.g. a create with no `id`), or a GET with an empty body, is `empty_or_invalid`, not success.
- **Try it runs reads only.** The server refuses writes; they'll go through approvals (slice 5). A success marks the action Tested; a 401/403 marks the credential "needs reconnect" and the review page says so.
- **Review rules live on the server.** Destructive actions can't drop approval (UI lock + server rule + DB constraint). Risk can be raised, never lowered below what the method implies. Changing method, path or inputs re-validates the whole action, re-applies safe defaults if the risk changes, and drops the evidence to "Needs review" (the old evidence was about a different request). Only draft versions are editable.
- **`actions.edited`** records when a person changed what the importer drafted (renames, descriptions, request changes; not on/off switches), for the "accepted without edits" metric.
- **`ajv` 8.20** for input validation (already in the tree via swagger-parser, now a direct dependency).
- **Measured:** Petstore "Find pets by status" via Try it: HTTP 200, 41 results, 248 ms, marked Tested, logged with its input.

## Design switch: C → B

- **Direction B (shipping manifest) replaced C (90s system utility)** after review. Only `globals.css`, the font setup and the UI kit changed; every screen picked it up because they use role classes (sheet, well, bar) and kit components, not raw colours. The metaphor now does product work: evidence is a stamp (TESTED / SOURCED / NEEDS REVIEW), risk is typed text, the MCP URL and token sit on a perforated tear-off strip.
- Stamps rotate 2° for character and lie flat under `prefers-reduced-motion`. Colour is never the only signal: every stamp is a word.

## Slice 4: Publish + MCP runtime

- **MCP SDK v2 + `mcp-handler` 2.3, on spec 2026-07-28.** The current spec is stateless (no `initialize`, no sessions; every POST carries its protocol version in a header and in `params._meta`; servers answer `server/discover`). `mcp-handler` serves that natively and falls back to 2025-era Streamable HTTP for older clients from the same handler. *Rejected:* SDK v1 (`@modelcontextprotocol/sdk`), which targets the previous spec; hand-rolling the transport.
- **Built per request, straight from the database.** `/api/mcp/:id` loads the connector's published version and registers its enabled actions as tools. Input schemas are the stored JSON Schemas, passed through `fromJsonSchema` (the SDK validates arguments with ajv before our code runs). No codegen, no cache to go stale: a publish is live on the next request.
- **Same request path as Try it.** Tools use the flat input shape and the executor from slice 3, so what you tested is what the AI employee runs.
- **Approval-required calls never execute.** They create a `tool_calls` row (pending_approval) and an `approvals` row with a plain-language summary, and tell the model to wait instead of retrying. Destructive actions are forced through approval in the runtime too, whatever the row says.
- **Tool descriptions say how a tool behaves** ("Read-only." / "a person must approve each call"), and annotations carry `readOnlyHint` / `destructiveHint`, so models plan around approvals.
- **Endpoint tokens:** `byo_` + 32 random bytes, shown once, SHA-256 at rest, one active token per connector (rotation revokes the old one immediately), last-used time recorded. Auth via `withMcpAuth` with `required: true`: 401 plus a Bearer challenge without a valid token.
- **Token in the URL is opt-in and labelled less secure** (`/api/mcp/:id/k/:token`), for MCP clients that can't send headers. Off by default; the console token is never accepted there.
- **Versioned publish.** Draft → published; the previous published version becomes superseded; `connectors.current_version_id` is what MCP serves. Editing after publish starts a new draft (a copy), so live tools never change under an AI employee until you publish again.
- **The test console is a real client.** It POSTs JSON-RPC over HTTP to the public endpoint with a 10-minute console token (HMAC, bound to the connector and the passcode), and shows the raw request and response. The target origin comes from Vercel's environment, never from the request's Host header, so a spoofed header can't send the console token elsewhere.
- **Verified three ways, live:** the in-app console (needs sign-in to click through), MCP Inspector 2.15 in CLI mode (list + call), and the official SDK client in both `auto` (2026-07-28) and `legacy` (2025) negotiation modes (list + call; refused without a token). An in-process suite covers discover, list, call, approvals, auth, bad arguments, unknown tools and legacy `initialize`.

## Design switch: B → Apple principles

- **Neither retro direction worked in review, so the UI now follows Apple's design principles** (fluid-interface and typography guidance): content over chrome, the platform's own font (no web fonts to download), grouped surfaces, semantic colour, instant press feedback, and short critically damped transitions. Same role classes and UI kit, so every screen changed in one place again.
- **Accessibility built in:** `prefers-reduced-motion` (no scaling or transitions), `prefers-reduced-transparency` (solid nav instead of blur), `prefers-contrast: more` (visible borders on every surface). All text colours pass AA in both themes; Apple's stock blue does not on white, so we use #0066CC.

## Slice 5: Safety + reliability

- **Approve runs exactly once.** Approving is a single atomic `UPDATE … WHERE status = 'pending' RETURNING`; only the caller that wins the claim executes. Double-clicks, two tabs, or two people can't run a write twice. Tested live with two simultaneous approvals: one ran, one was told "already approved", one call record.
- **Approval runs bypass the approval check, nothing else.** The same executor path (credentials decrypted per call, SSRF guard, classification, health) as every other call; the outcome is written onto the original call record, so the log shows one row per request.
- **Requests expire after 24 hours.** An AI employee's intent goes stale; approving yesterday's "refund this order" is a risk. Expiry is applied lazily when the inbox, a decision or a status check reads it (no cron to run or forget).
- **`check_approval` tool.** MCP is stateless, so the server can't tell the model when a person decides. The "waiting for approval" reply carries a short request ID; the model can call `check_approval` with it and get pending / rejected / expired / approved-with-result. Only this connector's requests are visible. It's registered only when some tool can need approval.
- **Destructive approvals ask once more** in the inbox (a native confirm with the exact summary). Only there: confirmations everywhere train people to click through.
- **Health is a pure rule** (`computeHealth`): not connected → needs reconnect (the app rejected the key) → failing (3 of the last 5 outcomes failed) → no calls yet → healthy. Validation errors (the model's bad input) and human decisions don't count against the app.
- **Reconnect loop:** a 401/403 marks the credential "needs reconnect" (Health, the Actions tab and the home list all say so, with a Reconnect button); the next successful call marks it active. Tested live against httpbin's basic-auth endpoint: wrong password → `auth_failed` → Needs reconnect → reconnect → Healthy.
- **One tab bar per app** (Actions, Health, Activity, Versions & endpoint, Test console, Connection) and a breadcrumb back to Apps, so every app page answers "where am I, where can I go".

## Slice 6: two real apps

- **Demo apps: Zendesk (OpenAPI) and BambooHR (docs page, AI).** Neither has an MCP page in UnleashX's docs (about 80 listed); Zendesk is named on UnleashX's site, so it's a "claimed but not built" gap; BambooHR is HR, a use case UnleashX sells. Freshdesk and Pipedrive were dropped as demo apps because UnleashX's docs already list them. (Both were added to the catalog later, to show breadth; see the catalog section below.)
- **Both run end to end from the UI** with real trial accounts: import → review → connect → Try it (Tested) → publish → MCP call; Zendesk also created a real ticket through the approvals inbox.
- **Large APIs start with nothing on (> 30 actions).** Zendesk's official spec has 675 actions; "reads on by default" would have published 350 tools, which models handle badly and some clients cap. The review page becomes a picker (search, per-group switches, live tool count, warning past 40). Small APIs keep "reads on". Off is still the safe direction, so this doesn't weaken the defaults.
- **Hostname placeholders are kept and asked for.** `https://{subdomain}.zendesk.com`: the spec's sample default ("example") would have pointed requests at someone else's account. Placeholders with real defaults (`{domain}` = zendesk) are filled; fixed value lists become a dropdown.
- **More destructive words:** redact, merge, erase, anonymize, wipe, terminate, permanently, truncate. "Redact Chat Comment" (PUT) erases data permanently and was only "write" before.
- **Zendesk sign-in:** Zendesk API tokens are deprecated (deleted after 30 days unused; all stop on 30 April 2027). OAuth client-credentials tokens work as bearer tokens but expire (default 30 min, max 48 h) and BYOMCP doesn't refresh them yet: **known gap, v2**. For the demo, an API token (basic auth: `email/token` + token) is the longer-lived choice.
- **Imports get 60 seconds.** Saving Zendesk's 675 actions takes about 14 s.

## Slice 7: redesign for first-time users

- **The problem was orientation, not styling.** A newcomer couldn't tell what this is, what to do first, what happens next, or where AI is used. Three visual directions (two retro, then Apple) hadn't fixed that, because none of them changed the flow.
- **Follow UnleashX's own design language** (deduced from four product screenshots): left sidebar with workspace and app list, breadcrumb top bar, one violet primary, white cards on a light grey canvas, tinted tags, underline tabs, a progress card with a checklist. BYOMCP should feel native to the product it plugs into. We borrowed the language, not UnleashX's name or logo. Font: Outfit (self-hosted via `next/font`, no new dependency). *Rejected:* another original direction, a fourth guess without a reference.
- **One obvious start.** Home has a single box: paste any link. The server decides whether it's an OpenAPI file (parsed, free) or a docs page (AI reads it), so the user never needs to know what OpenAPI is. Upload and paste stay one click away. Three starter chips (Petstore sample, Zendesk, BambooHR) give a path with no docs of your own.
- **Say where AI is, on the first screen.** The "How it works" strip tags every step "AI used here · once" or "No AI". The sidebar shows total AI spend, with "$0 per call" underneath.
- **A Setup panel on every app page** (like UnleashX's "Active plan"): six steps derived from data already in the database (actions, connection, a Tested action, published, a real MCP call), each a link, always ending in one "Next: …" button. No new table: `getSetupState` reads existing rows, so it can't drift.
- **"Next: Try an action" does the work.** It opens Try it on the read a newcomer can run without knowing any IDs (lists and searches first; required inputs need a default or a fixed list) and prefills defaults.
- **The sample connects itself** ("No sign-in"), so a newcomer reaches Tested → Published → a console call in about two minutes.
- **Publish has its own tab**, in process order: Actions, Connection, Publish, Test console, Health, Activity. *Rejected:* publishing from the bottom of the Actions list, which a newcomer had to scroll to find.
- **Jargon explained in place:** each term is explained where it appears (risk and evidence tags in the Actions explainer, a "?" on "action"), plus a How it works page with an FAQ (what an MCP server is, how to use it in UnleashX, what the AI sees, what happens when a key stops working), instead of a tour.
- **Full QA after the redesign** (desktop, tablet, phone; light and dark; keyboard), with 12 defects found and fixed. Logged in `docs/QA.md`.
- **Apps can be renamed inline** (Rename next to the title on every app page). Only the display name changes: the MCP address uses the app ID, so connected AI employees keep working; the MCP server name follows the new name. Names are trimmed, 1–60 characters.

## Workspaces: one per passcode

- **Each passcode opens its own workspace** (apps, approvals, activity, health, estimated AI cost), so people trying it don't see each other's work and per-person usage stays readable. *Rejected:* many passcodes into one shared workspace (blurs who did what, and anyone could approve anyone's writes); full user accounts (sign-up, email, password reset: too much for this stage).
- **The boundary is one place.** Apps carry `workspace_id`; everything else (versions, actions, calls, approvals, import jobs) hangs off an app. Every page and server action goes through `ownedConnector` / `ownsAction` / `ownsApproval` / `ownsImportJob` in `src/server/auth/guard.ts`; another workspace's app is answered exactly like a missing one ("not found"), so IDs reveal nothing. List queries (apps, approvals, spend, call stats) take a workspace id. An integration test checks the isolation against the real database.
- **The owner keeps `APP_PASSCODE`;** guests get generated passcodes (`byo-` plus 100 random bits), stored only as SHA-256 hashes, like endpoint tokens: high-entropy codes don't need a slow hash, and a database leak doesn't reveal them. `scripts/create-workspaces.mts` creates them and writes the plain codes to a gitignored local file; it refuses to run if that file isn't ignored.
- **The session cookie names its workspace** (`v2.<workspaceId>.<expiry>.<HMAC>`), so it can't be moved to another workspace. Revoking is checked on every request against the database (the proxy only checks the signature), so a revoked guest is signed out on their next click. Changing `APP_PASSCODE` still signs everyone out.
- **Owner-only Workspaces page:** last sign-in, apps (live), calls in 7 days, AI imports and estimated cost per workspace; rename, revoke and restore. The owner workspace can't be revoked from the app.
- **Guests get 20 AI imports per 24 hours.** Everyone shares one Gemini key on Google's free tier, so one person can't use up the day's allowance. OpenAPI imports, Try it and MCP calls use no AI and aren't limited. When Google's limit is hit, the error says so and points to an OpenAPI link instead.
- **"AI cost" is labelled an estimate everywhere.** It's tokens times Google's list price; on the free tier nobody is charged.
- **MCP is unchanged:** endpoints and tokens are per app, so published servers kept working through the migration.

## Slice 9a: start from the app's name

- **Why:** a non-technical user knows the app ("Zendesk"), not where its API docs live, what kind of key it takes, or what a "base address" is. Those were the three places the real-app path stalled.
- **A catalog of 7 apps** (Petstore sample, Zendesk, Intercom, HubSpot, Pipedrive, BambooHR, Calendly) as plain data in `src/lib/catalog.ts`. Spec URLs, sign-in type, key steps and job paths were taken from each vendor's own docs (13 Nov 2026), and **every entry must pass a real import** (`src/lib/catalog.integration.test.ts`, which also checks that every job's operations exist in the imported actions). The server resolves a catalog key to its URL; the browser never supplies one.
  - *Dropped after checking:* Stripe and GitHub (official specs are 8–14 MB with no split file, over our 5 MB cap; Stripe's starter jobs also move money); Airtable (every base has its own layout, so jobs can't be pre-built); Notion (needs a fixed `Notion-Version` header the runtime doesn't send yet); Freshdesk (its whole API is one 3.3 MB page that gives no usable text without JavaScript; pasting docs text still works); Intercom 2.11 (broken `$ref`, so we use 2.15).
  - *Known vendor changes:* Zendesk deletes unused API tokens after 30 days and ends API tokens on 30 Apr 2027 (OAuth is the long-term path, see 9e). HubSpot's spec only declares deprecated `hapikey` and OAuth, so the catalog forces bearer (service keys). Intercom recommends OAuth for third-party tools; the key steps say so.
- **Guided connection:** catalog apps show numbered "where to find your key" steps, the vendor's help link, whether admin rights are needed, what each address placeholder means, and what goes in username and password. Anyone can copy a ready-made message to their admin.
- **Save = check.** Saving a connection runs the read a newcomer could run without knowing any IDs (`src/lib/best-read.ts`: lists and searches first, required inputs must have a default or a fixed list) through the normal Try it path, so it's logged, marks Tested and flags rejected keys. The page says "✓ Connected and working: we got back 60 records" or gives one fix (wrong key, no permission, wrong address or subdomain, app having trouble). The sample runs the same check when it connects itself.
- **Pick by job:** catalog apps open with 2–3 jobs ("Answer customer tickets"). Choosing jobs turns on exactly those actions and turns the rest off; writes still need approval. Matching compares method and path from the end, so a `/api/v1` prefix kept in the server address still matches. Choosing actions one by one is still there.

## Slice 9b: readable results and a hand-off people can finish

- **Results read like data, not JSON.** `src/lib/result-shape.ts` (pure, tested) turns a list into a small table (useful columns first: name, title, subject, status, email, id) and a record into label/value pairs; raw data stays one click away. Used in Try it, the console and Approvals.
- **The console is a form.** It loads the tools on its own; you pick one by its plain title, fill the same form Try it uses (`src/components/schema-fields.tsx`), and see what your AI employee would get back, with a clear "waiting for approval" state. JSON input and the raw MCP messages are still there under "For engineers".
- **Publish ends in a hand-off.** "Copy setup" copies the address and the token together. Three steps say how to add it in UnleashX, and a prefilled message goes to whoever manages UnleashX (it never includes the token). The page says "✓ Your AI employee used it 3 minutes ago" once a real call arrives.
- **First run:** an empty workspace opens with "here's what you'll need" (the app's name, an admin login, about 5 minutes) and two starts: pick your app, or try the sample.
- **Request an app:** a search with no match offers "tell us which app"; requests (5 per workspace per day) appear on the owner's Workspaces page, so the catalog grows from demand.

## Slice 9c: "Talk to it", a test chat

- **Why:** the most convincing proof for a non-technical user is asking in plain words and watching an AI employee use the tools. Raw tool calls don't prove that.
- **It goes through the real path.** The chat's AI sees only the app's published tools, fetched from its own MCP address with a console token, and every call goes through that address. So approvals, logging and health behave exactly as for a real AI employee: a write ends at "waiting for approval", never runs. Checked live: a read was answered from tool results, and an "add a pet" request ended in the approvals inbox.
- **The runtime principle still holds.** Published connectors run with no AI; the chat is a testing tool inside BYOMCP, labelled "AI · for testing only", and the AI employee in UnleashX never uses our AI.
- **Data honesty:** this is the first place app data (tool results) goes to the AI. The chat starts only after a one-time notice: what's sent, that Google's free tier may use it, use test data, keys are never sent. Tool results are cut to 6,000 characters and the system prompt treats them as data, never instructions. At most 5 tool calls per message.
- **Limits:** guest workspaces get 30 messages per 24 hours (one shared Gemini key); each message's estimated cost is shown and added to the workspace's estimated AI spend. Provider-neutral `chatWithTools` in `src/server/llm/types.ts`; the Gemini adapter appends each model turn unchanged (Gemini 3 thought signatures) and returns all tool results in one turn matched by call id, per Google's function-calling docs (checked 13 Nov 2026).

## Slice 9d: approval emails

- **Approvals nobody sees don't help.** Each workspace can set one address on the Approvals page; when an AI employee's request starts waiting, we email a plain summary and a "Review in BYOMCP" link. The email never includes the payload or secrets.
- **Resend's REST API, no SDK:** one `POST https://api.resend.com/emails` through the SSRF-guarded fetch, with an `Idempotency-Key` per request (checked against Resend's docs, 13 Nov 2026). Sent with Next's `after()`, so the MCP reply never waits and a failed email never fails the call.
- **Not noisy:** at most once per request (an atomic `notified_at` claim) and at most one email per workspace per 10 minutes; the inbox and bell still show everything.
- **Needs the owner:** `RESEND_API_KEY` (free plan: 100 emails a day). Without a verified domain, Resend only delivers to the Resend account's own address, so emailing guests needs a domain. Without the key, the setting says email isn't set up yet.

## Slice 9e: Connect with Zendesk (OAuth)

- **No key to find.** On Zendesk's Connection tab, "Connect with Zendesk" sends you to Zendesk's consent screen and back, connected, with the same "Connected and working ✓" check. Zendesk is also retiring API tokens (30 Apr 2027), so OAuth is the long-term path.
- **Flow (checked against Zendesk's docs, 13 Nov 2026):** authorization code grant with PKCE (S256) and a confidential client; `state` is HMAC-signed, expires in 10 minutes and is bound to the workspace and the app; the PKCE verifier lives in a short-lived httpOnly cookie for that browser only. The code exchange and refreshes use the SSRF-guarded fetch; token bodies are never logged.
- **Tokens stay fresh:** access tokens last 30 minutes, refresh tokens 90 days (the most Zendesk allows). Both are stored encrypted as an `oauth` credential; the runtime refreshes two minutes before expiry, and once after a 401 (then retries; safe for writes, since a 401 means nothing ran). Zendesk rotates refresh tokens, so if two requests race, the loser re-reads the pair the winner saved instead of failing. A failed refresh shows "Needs reconnect" with "Sign in again with Zendesk".
- **Honest limit:** an OAuth client registered in one Zendesk works only for that account, so one-click sign-in is offered for `ZENDESK_OAUTH_SUBDOMAIN` only, and other Zendesk accounts keep the guided API-token path. A global client would need Zendesk's approval.
- **Needs the owner:** register an OAuth client in Zendesk Admin Center (Apps and integrations > APIs > OAuth clients, kind Confidential, redirect `https://byomcp.vercel.app/api/oauth/zendesk/callback`), then set `ZENDESK_OAUTH_CLIENT_ID`, `ZENDESK_OAUTH_CLIENT_SECRET` and `ZENDESK_OAUTH_SUBDOMAIN` in Vercel.
- **Light, Dark or Auto, chosen by the person.** Auto follows the device; the choice is remembered in the browser (`localStorage`) and applied by a tiny inline script before first paint, so it never flashes the other theme. Colours switch through the same tokens via `data-theme` on `<html>`, so every screen follows at once. The switch is at the bottom of the sidebar and on the sign-in page.

## Before going public: an independent security review

A fresh full-code review (cross-workspace access, auth, SSRF, secrets, injection, OAuth, headers, brute force, abuse, dependencies) found no critical issues and no cross-workspace path; `npm audit` showed no vulnerable production dependencies. Everything it did find was fixed:

- **Owner passcode brute force:** failed sign-ins are now limited to 10 per client per 15 minutes (the IP stored only as a keyed hash), and past 100 failures overall every failure slows down. Guest passcodes have 100 random bits and can't be guessed.
- **A saved key could follow a changed server address:** changing an app's host now requires entering the key again. A saved key is only ever sent to the host it was saved for. Covered by an integration test.
- **Abuse limits:** 60 MCP calls per app per minute, 50 pending approvals per app, and 25 apps per guest workspace.
- **Race-safe caps:** test-chat messages and AI imports are reserved, then counted, so parallel requests can't slip past the daily limits.
- **Alert emails:** an address only receives approval alerts after a signed confirmation link sent to it is opened, while signed in to that workspace.
- **Smaller fixes:**
  - The sign-in redirect refuses control characters, so `/\t/evil.com` can't become `//evil.com`.
  - Security headers: CSP `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `no-referrer` and HSTS.
  - Revoked workspaces' MCP servers stop answering.
  - Redirects across hosts drop credentials.
  - `.` and `..` are refused as path values, and the base-path check uses a trailing slash.
- **Publishing:** the public repository starts from one clean commit. The working history (with private planning notes) stays in a private archive.

## Walkthrough video: narrated

- **Voice from the captions, not a separate script.** Each on-screen caption is spoken by Gemini text-to-speech (`gemini-3.8-flash-tts`, voice Sulafat), with a separate "say" spelling only where pronunciation needs it ("Bring Your Own M C P"). One source keeps picture, captions and voice in sync. Only the caption text is sent to Google: no app data, keys or passcodes.
- **Timing follows the voice.** Each caption stays on screen until its clip has finished, and the moment it appears is recorded. ffmpeg then places each clip at that moment, so nothing overlaps or drifts, even when page loads vary.
- **MP4 (H.264 + AAC) instead of WebM.** It plays in browsers, QuickTime and Windows alike, and is a third of the size (5 MB for 2:55). Mixing needs a full ffmpeg (`FFMPEG`); Playwright's built-in copy has no audio encoder. Neither is a project dependency.
- **Free-tier friendly.** Clips are cached by their words, voice and model in the gitignored `.walkthrough/`, so re-runs only request changed lines (the free tier allows 3 a minute and 10 a day), and the script waits out rate limits.
- **Rejected:** the built-in Windows voices (free and offline, but robotic), and mixing in the browser by recording playback (no download, but re-encodes the picture in real time).

## Catalog: from 6 to 25 apps (plus the sample)

- **Chosen for breadth, not as proven gaps.** The 19 new apps were picked from the apps shown in UnleashX's product without a live MCP connection, limited to ones that work with a key or token and no vendor approval. UnleashX's public docs index (`docs.unleashx.ai/llms.txt`, 84 entries under `/mcp/`, checked 13 Nov 2026) lists all of them except Kaleyra, so they are not gaps in UnleashX's documented catalog. Of the 27 catalog apps, only Zendesk, BambooHR and Kaleyra have no page there. The catalog shows that the pipeline handles many API styles (OpenAPI, trimmed specs, docs pages, form bodies, keys in the path); it isn't a claim about what UnleashX lacks. The 19: Asana, Jira, Webflow, Mailchimp, Stripe (reads), Notion, Firecrawl, PDF.co, HeyGen, ActiveCampaign, Close, Instantly, Apollo, Flodesk, Typeform, Razorpay, Freshdesk, WooCommerce and Databricks. Every one passed a real import, and every job matched its actions, before shipping.
- **Where the spec comes from, in order of preference:** the vendor's official OpenAPI file (13 apps); a trimmed copy of it served from `/specs`, when the official one is over (or right at) the 5 MB limit or only embedded in a docs page (Stripe, Mailchimp, Instantly, Flodesk; `scripts/trim-spec.mts` regenerates them); AI reading the docs page (Typeform, Razorpay); and, where the docs can't be read reliably (too big, JavaScript-only), a small OpenAPI file written from the vendor's reference and labelled "written by BYOMCP" (Freshdesk, WooCommerce, Databricks).
- **Fixed headers.** A header with one allowed value (Notion's `Notion-Version`) is no longer asked of the AI employee: the importer marks it optional with that value, and the runtime sends it.
- **Vetted POST reads.** Some APIs search with POST (Notion, Jira, Apollo, Instantly, Firecrawl, PDF.co). A catalog entry can list those operations as reads, so they don't wait for approval. It can only turn write into read, never touch anything classed destructive, and it only applies to the catalog's own source URL.
- **Stand-in addresses.** Where a spec's server is a placeholder like `your-domain.atlassian.net`, the catalog gives the real template (`https://{site}.atlassian.net`) with a plain-language explanation of the blank.
- **Bug found and fixed:** job matching allowed a path prefix kept in the server address (`/api/v1`), which also let `POST /subscribers` match `POST /workflows/{id}/subscribers`. The prefix now has to be plain words (a base address never contains a `{parameter}`), and an exact match always wins.
- **Gallery stays calm.** The home grid shows the first 9 apps with "Show all 26 apps"; search always covers everything.
- **GREEN-API and Kaleyra (added after).** GREEN-API puts its token in the URL path. A catalog entry can now place an API key "in the path": the importer flags that path parameter, it's left out of every tool schema (the AI employee never sees or supplies it), the runtime fills it from the saved key, and the activity log hides it in raw and URL-encoded form. Kaleyra sends SMS as form fields: bodies the spec declares as `application/x-www-form-urlencoded` (or Swagger `formData`) are now sent as form fields. Before this they were sent as JSON, a latent bug for any form-only API.
- **Not added, and why:** monday.com is GraphQL only. Google, Microsoft, Meta, Zoho, LinkedIn, X, Reddit, Zoom, Dropbox, SurveyMonkey and Outreach need OAuth with BYOMCP registered and approved by each vendor.

## AI fallback on quota errors

- The backup model (`LLM_FALLBACK_MODEL`) used to step in only when Gemini was overloaded (503/504). On the free tier, quotas are counted per model, so a 429 ("quota used up") on the main model is exactly when the backup model still has room. After the usual retries, a 429 now falls back too. If both are out, the user sees the plain "today's free AI allowance is used up" message, and everything that doesn't use AI (catalog OpenAPI apps, connecting, publishing, running tools) keeps working.
- **A list, in order of free-tier room.** `LLM_FALLBACK_MODEL` now takes a comma-separated list. The free-tier limits per model (Google AI Studio, 13 Nov 2026) are: 3.5 Flash-Lite 15 requests/min and 500/day; 3.1 Flash-Lite 15/min and 500/day; 3.8 Flash only 5/min and 20/day. So the order is `gemini-3.5-flash-lite` (main), then `gemini-3.1-flash-lite`, then `gemini-3.8-flash`, which roughly doubles the daily allowance. A single value still works. The real fix for a busy public demo is enabling billing on the Gemini project (Tier 1 limits are far higher, at a cost of cents per import).

## Owner Usage page

- **One place to see everyone's usage.** `/usage` (owner only, `requireOwner`) shows totals across all workspaces (active in 7/30 days, apps, calls and failures, calls from AI employees, approvals, AI imports, test-chat messages, tokens, estimated AI cost), four 30-day bar charts (calls, AI imports, chat messages, sign-ins), and every workspace sorted by last activity. `/usage/:workspace` drills into one: its apps, the latest 50 calls, imports with tokens and cost, chat messages, sign-ins and app requests.
- **Activity, never content.** The queries (`src/server/workspaces/usage.ts`) select metadata only: no call inputs or results, approval payloads, credentials or tokens. There's no "sign in as them". The owner sees that a call happened, to which app and action, from where, and whether it worked.
- **A sign-in log.** Before this, only each workspace's latest sign-in was kept. `sign_ins` (workspace and time, nothing else) records every successful sign-in from 15 Nov 2026; the migration backfills each workspace's last known one. Failed attempts stay in `login_attempts` (IP as a keyed hash) for rate limiting and aren't shown.
- **"Failed" means the app or connection failed** (empty or invalid, key rejected, app unavailable, request error), not the AI employee's bad input or a person's rejection, so the number reflects connector health.
- **Days are India time** (`USAGE_TZ`), because the owner reads it there; the server runs in UTC. Charts are plain HTML bars (no chart dependency), with a text summary for screen readers.
- **Rejected:** Vercel Analytics or an analytics service (page views, not product usage, and another account), and an event table for everything (the existing rows already record each call, import and chat message).
