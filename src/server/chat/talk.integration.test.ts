/**
 * Real AI + a real MCP endpoint. Opt-in, because it uses the shared Gemini allowance:
 *   RUN_INTEGRATION=1 TALK_CONNECTOR_ID=<published app> TALK_WORKSPACE_ID=<its workspace> \
 *   [PORT=3100 APP_PASSCODE=<that server's passcode>] npx vitest run talk.integration
 * A read is answered from tool results; a write ends up waiting for approval, not run.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const enabled = process.env.RUN_INTEGRATION === "1" && !!process.env.TALK_CONNECTOR_ID && !!process.env.TALK_WORKSPACE_ID;
if (enabled && existsSync(".env.local")) {
  const keep = { PORT: process.env.PORT, APP_PASSCODE: process.env.APP_PASSCODE };
  process.loadEnvFile(".env.local");
  Object.assign(process.env, Object.fromEntries(Object.entries(keep).filter(([, v]) => v)));
}

describe.skipIf(!enabled)("Talk to it, end to end", () => {
  const ws = { id: process.env.TALK_WORKSPACE_ID!, isOwner: true };
  const connectorId = process.env.TALK_CONNECTOR_ID!;

  it("answers a read from the app's tools", { timeout: 120_000 }, async () => {
    const { talkToApp } = await import("./talk");
    const r = await talkToApp({ workspace: ws, connectorId, appName: "Petstore (sample)", messages: [{ role: "user", text: "How many pets are available right now? Use the tools." }] });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    console.log("steps:", r.steps.map((s) => `${s.tool}${s.isError ? " (error)" : ""}`).join(", "), "| answer:", r.answer.slice(0, 200), "| cost:", r.costUsd);
    expect(r.steps.length).toBeGreaterThan(0);
    expect(r.steps.some((s) => !s.isError)).toBe(true);
  });

  it("a write waits for approval instead of running", { timeout: 120_000 }, async () => {
    const { talkToApp } = await import("./talk");
    // Make sure a write is published: turn on "Add a new pet" (approval required) and publish.
    const { startNewDraft, publishLatest } = await import("@/server/publish/publish");
    const { getConnectorForReview } = await import("@/server/connectors/queries");
    const { updateAction } = await import("@/server/connectors/review");
    const draft = await startNewDraft(connectorId);
    expect(draft.ok).toBe(true);
    const data = await getConnectorForReview(connectorId);
    const addPet = data!.actions.find((a) => a.method === "POST" && a.path === "/pet");
    expect(addPet).toBeTruthy();
    const upd = await updateAction(addPet!.id, { enabled: true, requiresApproval: true });
    expect(upd.ok).toBe(true);
    expect((await publishLatest(connectorId)).ok).toBe(true);

    const r = await talkToApp({
      workspace: ws,
      connectorId,
      appName: "Petstore (sample)",
      messages: [{ role: "user", text: 'Add a new pet named "Chat QA Rex" with id 4242002, status available, no photos.' }],
    });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    console.log("write steps:", r.steps.map((s) => `${s.tool}: ${s.result.slice(0, 60)}`).join(" | "), "| answer:", r.answer.slice(0, 200));
    expect(r.steps.some((s) => /^Waiting for approval/.test(s.result))).toBe(true);
  });
});
