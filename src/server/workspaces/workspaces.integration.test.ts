/**
 * Real database. Opt-in:  RUN_INTEGRATION=1 npx vitest run integration
 * Workspace isolation: a guest workspace's app never shows up in the owner's
 * lists (and vice versa), passcodes open the right workspace, and a revoked
 * passcode stops working. Deletes the guest workspace (and its apps) after.
 */
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_INTEGRATION === "1";
if (enabled && !process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");

describe.skipIf(!enabled)("workspace isolation", () => {
  let guestId: string | null = null;

  afterAll(async () => {
    if (!guestId) return;
    const { db } = await import("@/server/db");
    const { workspaces } = await import("@/server/db/schema");
    await db().delete(workspaces).where(eq(workspaces.id, guestId));
  });

  it("keeps each workspace's apps, spend and stats to itself", { timeout: 60_000 }, async () => {
    const { db } = await import("@/server/db");
    const { workspaces } = await import("@/server/db/schema");
    const { generatePasscode, hashPasscode } = await import("@/server/auth/session");
    const ws = await import("./workspaces");
    const { listConnectors } = await import("@/server/connectors/queries");
    const { callStats7d, totalAiSpend } = await import("@/server/connectors/setup-state");
    const { countPending, listApprovals } = await import("@/server/approvals/approvals");
    const { runOpenApiImport } = await import("@/server/import/run-openapi-import");

    const owner = await ws.ownerWorkspace();
    const code = generatePasscode();
    const [guest] = await db()
      .insert(workspaces)
      .values({ label: "Isolation test", passcodeHash: hashPasscode(code) })
      .returning({ id: workspaces.id });
    guestId = guest.id;

    // The passcode opens the guest workspace, not the owner's.
    expect((await ws.workspaceForPasscode(code, "not-the-owner-passcode"))?.id).toBe(guest.id);
    expect(await ws.workspaceForPasscode("byo-WRONG-WRONG-WRONG-WRONG", "not-the-owner-passcode")).toBeNull();

    const imported = await runOpenApiImport({
      workspaceId: guest.id,
      name: "Isolation test app",
      source: { kind: "openapi_url", url: "https://petstore3.swagger.io/api/v3/openapi.json" },
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    const guestApps = (await listConnectors(guest.id)).map((c) => c.id);
    const ownerApps = (await listConnectors(owner.id)).map((c) => c.id);
    expect(guestApps).toEqual([imported.connectorId]);
    expect(ownerApps).not.toContain(imported.connectorId);

    // A saved key is never sent to a new host: changing the address needs the key again.
    const { saveConnection } = await import("@/server/connectors/connection");
    const id = imported.connectorId;
    const key = { kind: "bearer" as const, token: "test-token-not-real-123" };
    expect((await saveConnection({ connectorId: id, baseUrl: "https://petstore3.swagger.io/api/v3", authType: "bearer", secret: key })).ok).toBe(true);
    expect((await saveConnection({ connectorId: id, baseUrl: "https://petstore3.swagger.io/api/v4", authType: "bearer" })).ok).toBe(true); // same host
    const moved = await saveConnection({ connectorId: id, baseUrl: "https://attacker.example", authType: "bearer" });
    expect(moved.ok).toBe(false);

    // Aggregates are scoped too (nothing from the guest leaks into the owner's numbers).
    expect(await totalAiSpend(guest.id)).toBe(0);
    expect((await callStats7d(owner.id)).has(imported.connectorId)).toBe(false);
    expect(await countPending(guest.id)).toBe(0);
    expect(await listApprovals({ workspaceId: guest.id, pending: false })).toEqual([]);

    // Revoking stops the passcode and the session check; restoring brings both back.
    await ws.setWorkspaceRevoked(guest.id, true);
    expect(await ws.workspaceForPasscode(code, "not-the-owner-passcode")).toBeNull();
    expect(await ws.activeWorkspace(guest.id)).toBeNull();
    await ws.setWorkspaceRevoked(guest.id, false);
    expect((await ws.activeWorkspace(guest.id))?.label).toBe("Isolation test");

    // The owner workspace can't be revoked from the app.
    await ws.setWorkspaceRevoked(owner.id, true);
    expect(await ws.activeWorkspace(owner.id)).not.toBeNull();
  });
});
