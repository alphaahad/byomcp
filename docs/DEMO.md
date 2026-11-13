# Demo script (3 minutes)

The new UI (slice 7) uses two real apps: **Zendesk** (OpenAPI, no AI) and **BambooHR** (docs page, AI). In the workspace they're named "Zendesk" and "BambooHR".

**Before recording:**
- Sign in.
- Connect Zendesk on its **Connection** tab: **Connect with Zendesk** (OAuth, refreshes itself) or a guided API token.
- Run List Tickets once with **Try it**, and make sure Zendesk is published with List / Show / Create / Update Ticket on.
- Check the Approvals bell is empty.

## 1. The problem and the promise (20 s)

Open **Home**.

> "AI employees act through apps, and every app without an MCP server is engineering work today. BYOMCP lets a CS or ops person close that gap from the app's own docs, safely."

Point at the hero and the **How it works** strip:

> "Four steps. Only the first uses AI, once, about a cent. Everything after is deterministic: $0 per call."

## 2. Start from the app's name (50 s)

1. In **Which app should your AI employee use?**, click **BambooHR**. "I picked the app by name. I never needed to find its API docs. For apps that aren't listed, I paste any docs link and it works out what kind it is."
2. On the progress page, point out pages read, parts checked by AI, actions found, and the live AI cost.
3. The review opens with "We read the docs and found 10 actions" and the **Setup** panel on the right:

   > "There's always one next step."

4. On an action, point at **From the docs**:

   > "Every action carries a quote from the docs, checked against the text. If we can't find it, it says Needs review. We never show a citation we couldn't verify."

5. The contrast: open the Zendesk app.

   > "This came from Zendesk's OpenAPI file. 675 actions, no AI, $0. Big APIs start with nothing on; you pick what the AI employee needs."

## 3. Choose, connect, test (40 s)

1. On Zendesk's **Actions** tab, four actions are on.

   > "Reads run directly. Create and Update need approval. Destructive actions can never skip it."

2. **Connection** tab.

   > "The key is encrypted, never shown again, and never sent to the AI."

3. Open the **Connection** tab: the key steps for Zendesk are right there. Click **Connect with Zendesk** (or paste a token) and save. BYOMCP checks it at once: **"✓ Connected and working: we got back 25 tickets"**. Setup ticks over.
4. Back on **Actions**, under **What should your AI employee do?**, tick **Answer customer tickets**: exactly those actions turn on.

## 4. Publish and use (50 s)

1. **Publish** tab: the MCP address, the token (shown once), and how to add it in UnleashX, Claude or MCP Inspector.
2. **Test console** → **Talk to it**: "Show me open tickets about refunds." Watch it pick the tool and answer. Then: "Add an internal note to the first one." The reply is "waiting for approval", and the email arrives.

   > "Nothing has been sent to Zendesk."

3. The **bell** shows 1 → **Approvals**: the request in plain words and the exact payload → **Approve and run** → done, HTTP 201.

   > "It runs exactly once, even if two people click."

4. Show the new ticket in Zendesk. Back in the console, call `check_approval` with the request ID.

   > "MCP is stateless, so the AI employee asks for the result."

## 5. Health (20 s)

1. **Health** tab: Healthy, success rate, each tool's last result.
2. **Activity**: every call with its source (Try it, AI employee, approval) and secrets hidden.

> "That's the loop: docs to a safe, working MCP server, with evidence, approvals and health, and no AI cost per call."

## No account handy? The 2-minute sample

On Home, click **Try a sample: Petstore**. It's connected automatically.

1. **Next: Try an action** runs a real read.
2. **Next: Publish**.
3. **Next: Open the test console**.

That's the same flow with nothing to set up.

## Backup lines for questions

- **Why not generate code per connector?** One reviewed runtime reading stored definitions is easier to review, version, secure and update than hundreds of generated servers.
- **What stops the AI from inventing endpoints?** Quotes are checked against the docs text, risk and approvals come from rules rather than the model, and a person reviews before publishing.
- **Credentials?** Encrypted at rest and bound to their connector, injected server-side per call, scrubbed from logs, and never sent to the AI.
- **OAuth apps?** Zendesk has full OAuth with automatic refresh (PKCE, rotating refresh tokens). Other providers can reuse the same pattern; bearer tokens work for the rest.
- **Why does it look like UnleashX?** It's meant to plug into UnleashX, so it uses the same design language: sidebar, violet primary, cards, a progress panel.
