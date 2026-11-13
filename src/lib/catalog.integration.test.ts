/**
 * Real network + real database. Opt-in:  RUN_INTEGRATION=1 npx vitest run catalog.integration
 * Every catalog app must import for real, and every job must match imported
 * actions, before it ships. OpenAPI apps are imported (no AI, free). Docs-page
 * apps are fetched; set RUN_CATALOG_AI=1 to run their AI imports too (costs a
 * few cents and uses the shared Gemini allowance). Uses a throwaway workspace.
 */
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { CATALOG, jobActionIds } from "./catalog";

const enabled = process.env.RUN_INTEGRATION === "1";
const withAi = process.env.RUN_CATALOG_AI === "1";
if (enabled && !process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");

describe.skipIf(!enabled)("catalog apps import for real", () => {
  let workspaceId: string | null = null;

  const workspace = async () => {
    if (workspaceId) return workspaceId;
    const { db } = await import("@/server/db");
    const { workspaces } = await import("@/server/db/schema");
    const { generatePasscode, hashPasscode } = await import("@/server/auth/session");
    const [w] = await db()
      .insert(workspaces)
      .values({ label: "Catalog check", passcodeHash: hashPasscode(generatePasscode()) })
      .returning({ id: workspaces.id });
    workspaceId = w.id;
    return w.id;
  };

  afterAll(async () => {
    if (!workspaceId) return;
    const { db } = await import("@/server/db");
    const { workspaces } = await import("@/server/db/schema");
    await db().delete(workspaces).where(eq(workspaces.id, workspaceId)); // cascades to its apps
  });

  for (const app of CATALOG.filter((a) => a.source.kind === "openapi_url")) {
    it(`${app.name}: imports and every job matches`, { timeout: 120_000 }, async () => {
      const { runOpenApiImport } = await import("@/server/import/run-openapi-import");
      const { getConnectorForReview } = await import("@/server/connectors/queries");
      const out = await runOpenApiImport({ workspaceId: await workspace(), name: app.name, source: { kind: "openapi_url", url: app.source.url } });
      expect(out.ok, out.ok ? "" : out.error).toBe(true);
      if (!out.ok) return;
      const data = await getConnectorForReview(out.connectorId);
      const actions = data!.actions;
      for (const job of app.jobs) {
        const matched = jobActionIds([job], actions);
        const missing = job.ops.filter((o) => jobActionIds([{ ...job, ops: [o] }], actions).length === 0);
        expect(missing, `${app.name} / ${job.title}: unmatched ${missing.map((m) => `${m.method} ${m.path}`).join(", ")}`).toEqual([]);
        expect(matched.length).toBeGreaterThan(0);
      }
    });
  }

  for (const app of CATALOG.filter((a) => a.source.kind === "docs_url")) {
    it(`${app.name}: docs page opens${withAi ? ", imports with AI and jobs match" : ""}`, { timeout: 300_000 }, async () => {
      const { safeFetch } = await import("@/server/net/safe-fetch");
      const res = await safeFetch(app.source.url, { maxBytes: 5 * 1024 * 1024 });
      expect(res.status).toBe(200);
      if (!withAi) return;
      const { startAiImport, stepAiImport } = await import("@/server/import/run-ai-import");
      const { getConnectorForReview } = await import("@/server/connectors/queries");
      const started = await startAiImport({ workspaceId: await workspace(), isOwner: true, name: app.name, source: { kind: "docs_url", url: app.source.url, maxPages: 10 } });
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      let progress = await stepAiImport(started.jobId);
      for (let i = 0; i < 200 && progress && progress.stage !== "done" && progress.stage !== "failed"; i++) {
        await new Promise((r) => setTimeout(r, 700));
        progress = await stepAiImport(started.jobId);
      }
      expect(progress?.stage, progress?.error ?? "").toBe("done");
      const data = await getConnectorForReview(progress!.connectorId!);
      const report = app.jobs.map((j) => `${j.title}: ${jobActionIds([j], data!.actions).length}/${j.ops.length}`);
      console.log(`${app.name} (${data!.actions.length} actions): ${report.join(" · ")}`);
      expect(app.jobs.some((j) => jobActionIds([j], data!.actions).length > 0)).toBe(true);
    });
  }
});
