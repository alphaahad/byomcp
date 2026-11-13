/** Opt-in: RUN_INTEGRATION=1 npx vitest run llm/live — one tiny real Gemini call. */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const enabled = process.env.RUN_INTEGRATION === "1";
if (enabled && existsSync(".env.local")) process.loadEnvFile(".env.local");

describe.skipIf(!enabled)("Gemini, live", () => {
  it("returns schema-shaped JSON with usage", { timeout: 60_000 }, async () => {
    const { getLlm, estimateCostUsd } = await import("./index");
    const llm = getLlm();
    const res = await llm.generateJson({
      system: "Extract data exactly as asked.",
      prompt: "The endpoint GET /v1/employees lists employees.",
      jsonSchema: {
        type: "object",
        properties: { method: { type: "string", enum: ["GET", "POST"] }, path: { type: "string" } },
        required: ["method", "path"],
      },
    });
    const data = JSON.parse(res.text);
    expect(data).toEqual({ method: "GET", path: "/v1/employees" });
    expect(res.usage.inputTokens).toBeGreaterThan(0);
    const cost = estimateCostUsd(llm.model, res.usage);
    console.log("model", llm.model, "usage", res.usage, "cost", cost);
    expect(cost).not.toBeNull();
  });
});
