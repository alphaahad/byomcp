/**
 * Real database. Opt-in:  RUN_INTEGRATION=1 npx vitest run usage.integration
 * A sign-in is logged and shows up in the owner's usage totals, by day and by
 * workspace. Uses a throwaway workspace and deletes it (cascades its sign-ins).
 */
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const enabled = process.env.RUN_INTEGRATION === "1";
if (enabled && !process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");

describe.skipIf(!enabled)("owner usage", () => {
  let workspaceId: string | null = null;

  afterAll(async () => {
    if (!workspaceId) return;
    const { db } = await import("@/server/db");
    const { workspaces } = await import("@/server/db/schema");
    await db().delete(workspaces).where(eq(workspaces.id, workspaceId));
  });

  it("logs every sign-in and counts it", async () => {
    const { db } = await import("@/server/db");
    const { workspaces } = await import("@/server/db/schema");
    const { generatePasscode, hashPasscode } = await import("@/server/auth/session");
    const { recordSignIn } = await import("./workspaces");
    const usage = await import("./usage");

    const [w] = await db().insert(workspaces).values({ label: "Usage check", passcodeHash: hashPasscode(generatePasscode()) }).returning({ id: workspaces.id });
    workspaceId = w.id;
    const before = await usage.usageTotals();

    await recordSignIn(w.id);
    await recordSignIn(w.id);

    const row = (await usage.usageByWorkspace()).find((x) => x.id === w.id);
    expect(row?.signIns).toBe(2);
    expect(row?.lastActiveAt).not.toBeNull();
    const days = await usage.usageByDay(w.id);
    expect(days).toHaveLength(usage.USAGE_DAYS);
    expect(days[days.length - 1].signIns).toBe(2);
    const after = await usage.usageTotals();
    expect(after.signIns30d - before.signIns30d).toBe(2);
    expect(after.workspaces).toBe(before.workspaces + 1);

    const detail = await usage.workspaceUsageDetail(w.id);
    expect(detail.signIns).toHaveLength(2);
    expect(detail.apps).toEqual([]);
  });
});
