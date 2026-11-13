/**
 * Price table for cost ESTIMATES shown in the UI. USD per 1M tokens.
 * Output price includes thinking tokens (Gemini bills them as output).
 * Source: https://ai.google.dev/gemini-api/docs/pricing (checked 2026-11-13).
 * Unknown models return null and the UI says "cost unknown" rather than guessing.
 */
import type { LlmUsage } from "./types";

type Price = { inputPerM: number; outputPerM: number; note: string };

export const PRICES_AS_OF = "2026-11-13";

const PRICES: Record<string, Price> = {
  "gemini-3.5-flash-lite": {
    inputPerM: 0.3,
    outputPerM: 2.5,
    note: "Standard paid tier. Free tier is $0.",
  },
  "gemini-3.1-flash-lite": {
    inputPerM: 0.25,
    outputPerM: 1.5,
    note: "Standard paid tier. Free tier is $0.",
  },
  "gemini-3.8-flash": {
    inputPerM: 0.75,
    outputPerM: 3.75,
    note: "Introductory rate until 2026-12-31; $1.50 / $7.50 from 2027-01-01.",
  },
};

export function priceFor(model: string): Price | undefined {
  return PRICES[model];
}

export function estimateCostUsd(model: string, usage: LlmUsage): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (usage.inputTokens * p.inputPerM + usage.outputTokens * p.outputPerM) / 1_000_000;
}
