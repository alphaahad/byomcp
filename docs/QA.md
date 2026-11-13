# QA log: Slices 7 + 8

End-to-end pass on 13 Nov 2026, after the redesign. Run locally (`next dev`, same Neon database as production) in a real browser, signed in with a throwaway passcode. Anything that changed data used throwaway apps, deleted afterwards. The user's own apps were only looked at.

## Paths covered

| # | Path | Result |
|---|---|---|
| 1 | Newcomer, cold: Home → "Try a sample: Petstore" → review (`?new=1` notice, auto-connected, "No sign-in") | Pass |
| 2 | Setup panel "Next: Try an action" → opens Try it on the best read ("Finds Pets by status", `available` prefilled) → HTTP 200 → Tested | Pass, after fix D2 |
| 3 | Publish tab → Publish → token shown once → published page lists the right tool count | Pass, after fix D4 |
| 4 | Test console: discover, list tools, call a read | Pass, after fix D5 |
| 5 | New draft → turn on a write ("Add a new pet") → Unpublished changes → Publish v2 | Pass |
| 6 | Console calls the write → "Waiting for approval… Request apr_…" → Approvals inbox (badge 1) → Approve and run → HTTP 200, ran once → badge cleared | Pass |
| 7 | `check_approval` with `request_id` → "approved and run. It worked (HTTP 200)" plus the app's response. A wrong argument name gets a clear validation error. | Pass |
| 8 | Activity (filters, approval call logged as "AI employee") and Health (Healthy, 75 %, per-tool last result) | Pass |
| 9 | AI path: "BambooHR employees" chip → progress page (pages read, parts checked by AI, cost) → 10 actions, $0.0068 → review with evidence tags | Pass |
| 10 | Large OpenAPI: "Zendesk tickets" chip → 675 actions in 92 groups, all off, Setup says "Choose actions"; search "list tickets" narrows correctly | Pass, after fix D8 |
| 11 | Failure paths in the start box: not a URL, `http://`, private IP, HTTP 404 page, `ftp://` | Pass, after fix D6 |
| 12 | Try it against a wrong company address (BambooHR 404) | Pass, after fix D7 |
| 13 | Phone (375 px) light and dark: Home, review, approvals, connect, publish, console, health, activity, How it works, new app, 404. No sideways scroll. Menu opens and closes. | Pass, after fixes D9–D11 |
| 14 | Tablet (768 px), light | Pass |
| 15 | Keyboard: skip link first, visible violet focus ring on every control, chips and Start reachable in order | Pass |
| 16 | `npm run check`: typecheck, lint, 147 unit tests | Pass |

The wrong-key path (401 → "Needs reconnect" → reconnect) wasn't reproducible here, because BambooHR answers an unknown company with 404 before it checks the key. It's covered by the Slice 5 tests and by the earlier manual check against the real BambooHR trial.

## Defects found and fixed

| ID | What was wrong | Fix |
|---|---|---|
| D1 | Link-styled buttons showed violet text on violet | Element defaults moved into `@layer base`, so component classes win |
| D2 | Auto "Try it" picked "Find pet by ID", which needs an ID a newcomer doesn't have | Score the reads: prefer list/find/search, penalise required inputs with no default or enum; prefill defaults and the first enum value |
| D3 | The `#publish` anchor didn't scroll from the Setup panel | The Publish step now goes to the Publish tab, which embeds the publish bar |
| D4 | The published page said "0 tools" | The subquery bound `id` to `actions.id`; columns are now qualified explicitly |
| D5 | The console argument skeleton left enum fields empty, and the Setup panel stayed stale after a call | The skeleton uses defaults and enums; `router.refresh()` after `tools/call` |
| D6 | `ftp://…` gave "Couldn't find ftp (ENOTFOUND)" | Non-web schemes are rejected with "Only secure web addresses (https://) are allowed."; DNS errors say "Check the address is spelled right." with no error codes |
| D7 | A 404 with no body said only "The app said the request was wrong (HTTP 404)." | "The app found nothing at that address (HTTP 404). Check the app's address in Connection, and any IDs you entered." |
| D8 | Action descriptions from specs showed raw Markdown (`#### Allowed For * Agents`) | Shown as plain text (headings, bullets, links and code ticks stripped); the editable text is unchanged |
| D9 | On a phone, a finished Setup panel filled the first screen | Narrow screens show only the next step; once setup is done the panel moves below the content |
| D10 | Card titles were cut off with "…" on a phone | Titles wrap (balanced) instead of truncating |
| D11 | "Recently decided" squeezed the summary into a one-word column on a phone | The summary keeps a 12 rem minimum and wraps under the tag |
| D12 | The start box placeholder was cut off on a phone | Shorter placeholder |

## Known, accepted

- Petstore's `/store/inventory` returns HTTP 500. That's the public sandbox, not us; the auto-try avoids it.
- Right after Publish, the header says "Not published" until you continue past the one-time token, so the token isn't lost to a refresh.
- The "N" badge bottom-left in screenshots is the Next.js dev indicator; it isn't in production.

# Slice 9: the non-technical path (13 Nov 2026)

| Check | How | Result |
|---|---|---|
| Every catalog app imports, and every job's operations exist | `catalog.integration.test.ts`, real imports (OpenAPI apps) and real AI imports (BambooHR) | Pass; Freshdesk dropped (no usable text without JavaScript), Intercom moved to spec 2.15 (2.11 has a broken `$ref`) |
| Catalog grid, Zendesk job picker ("4 actions are on"), key guide, placeholder meaning, basic-auth hints | Browser, fresh guest workspace, desktop and phone | Pass |
| Save and check: wrong subdomain gives one fix ("Nothing was found at that address… check your subdomain") | Browser | Pass |
| Save and check: success ("✓ Connected and working… got back 60 records", Tested, Setup 4/6) | Browser, Petstore | Pass |
| Publish tab: usage line, Copy setup, 3 UnleashX steps, message for whoever sets it up, other tools | Server-rendered page checked | Pass; click-through pending (below) |
| Readable results (table and fields), approval and Try it result views | Unit tests (`result-shape.test.ts`) | Pass |
| Talk to it: a read is answered from tool results; a write ends at "waiting for approval" | `talk.integration.test.ts`: real Gemini, real MCP endpoint | Pass |
| Chat loop: results returned in one turn by id, cap of 5 tool calls, errors passed back | `chat-loop.test.ts` | Pass |
| Approval emails: throttle, escaping, at most once | `email.test.ts`; live send needs `RESEND_API_KEY` | Unit tests pass; live send pending |
| Zendesk OAuth: consent URL, code exchange, refresh, rotation (`invalid_grant`), missing refresh token, signed state (tamper, expiry, key) | `zendesk.test.ts`, `state.test.ts` (mocked Zendesk) | Pass; live sign-in pending (needs the OAuth client env vars) |
| All suites | `npm run check` (182 tests), integration suites (29), live SDK and Inspector tests against production | Pass |

**Visual click-through (browser, guest workspace):**

| Check | Result |
|---|---|
| Talk to it: notice, consent remembered, "which pets are available?" answered from the tool, step shows a readable table, cost and messages left shown | Pass, after fixes D13 and D14 |
| Talk to it: "add a pet" ends at "⏳ waiting for approval", and the request appears in Approvals | Pass |
| Approvals: approve shows "Approved · done, ran once" and a readable record; reject shows "Nothing was sent" | Pass, after fix D15 |
| Run a tool yourself: tools load on their own, the form (Status: available), "✓ It worked" with a table | Pass |
| Email setting: says alerts aren't set up while `RESEND_API_KEY` is missing | Pass |
| Welcome card in an empty workspace, Hide remembered; "Request an app" prefilled from the search, saved | Pass |

| ID | What was wrong | Fix |
|---|---|---|
| D13 | Chat steps showed raw JSON: the tool result was cut to 6,000 characters for the AI, and the screen got the cut copy | The AI still gets the short copy; the screen gets up to 60,000 characters, so the table renders |
| D14 | Chat answers showed Markdown backticks | Plain-text instruction plus stripping of stray Markdown |
| D15 | A single record with an empty array (a pet's `tags: []`) showed "Nothing found (an empty list)" | A record with its own id, name or title is a record; an empty array is a list only in a small wrapper (unit test added) |
| D16 | "How it works" step 1 still said "Bring the docs" | "Pick the app" (list or docs link; AI only for docs pages) |

Note: in the in-app browser pane, React's streamed sections only appear once the window paints (`requestAnimationFrame`). A hidden or idle pane shows "Loading…" until then. That's an environment quirk; regular browsers aren't affected.

**Still pending:** a live approval email (needs `RESEND_API_KEY`) and a live Zendesk sign-in (needs the `ZENDESK_OAUTH_*` settings).
