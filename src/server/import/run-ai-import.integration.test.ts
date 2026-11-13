/**
 * Real network + real Gemini + real database. Opt-in:
 *   RUN_INTEGRATION=1 npx vitest run run-ai-import
 * Imports 4 pages of BambooHR's API reference, drives the steps like the
 * progress page does, checks the result, then deletes what it created.
 */
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_INTEGRATION === "1";
if (enabled && existsSync(".env.local")) process.loadEnvFile(".env.local");

describe.skipIf(!enabled)("AI import, end to end", () => {
  const created: string[] = [];
  afterAll(async () => {
    const { db } = await import("@/server/db");
    const { connectors } = await import("@/server/db/schema");
    for (const id of created) await db().delete(connectors).where(eq(connectors.id, id));
  });

  it("reads BambooHR docs into reviewed-ready actions", { timeout: 300_000 }, async () => {
    const { startAiImport, stepAiImport } = await import("./run-ai-import");
    const { getConnectorForReview } = await import("@/server/connectors/queries");
    const started = await startAiImport({ workspaceId: (await (await import("@/server/workspaces/workspaces")).ownerWorkspace()).id, name: "BambooHR (integration test)",
      source: { kind: "docs_url", url: "https://documentation.bamboohr.com/reference/get-employee", maxPages: 6 },
    });
    if (!started.ok) throw new Error(started.error);

    let progress = await stepAiImport(started.jobId);
    created.push(progress!.connectorId);
    const log: string[] = [];
    for (let i = 0; i < 40 && progress && !["done", "failed"].includes(progress.stage); i++) {
      log.push(`${progress.stage} pages=${progress.pagesRead}/${progress.pagesPlanned} chunks=${progress.chunksDone}/${progress.chunksTotal} found=${progress.actionsFound} cost=${progress.costUsd}`);
      progress = await stepAiImport(started.jobId);
    }
    log.push(`${progress?.stage} error=${progress?.error} found=${progress?.actionsFound} cost=${progress?.costUsd} warnings=${JSON.stringify(progress?.warnings)}`);
    console.log(log.join("\n"));
    expect(progress?.stage, log.join("\n")).toBe("done");

    const data = await getConnectorForReview(progress!.connectorId);
    const summary = data!.actions.map((a) => `${a.method} ${a.path} | ${a.title} | ${a.risk} | ${a.evidence} | ${a.citation?.quote?.slice(0, 60) ?? "-"}`);
    console.log(summary.join("\n"));
    console.log("detected", JSON.stringify(data!.version!.detected), "cost", data!.version!.importCostUsd, "tokens", data!.version!.tokensIn, data!.version!.tokensOut);
    expect(data!.actions.length).toBeGreaterThanOrEqual(3);
    expect(data!.actions.some((a) => a.path.includes("/employees/{"))).toBe(true);
    expect(Number(data!.version!.importCostUsd)).toBeGreaterThan(0);
  });
});
