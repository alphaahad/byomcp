import "server-only";
import { env } from "@/server/env";
import { GeminiProvider } from "./gemini";
import { LlmError, type LlmProvider } from "./types";

export { LlmError, type ChatStep, type LlmProvider, type LlmUsage } from "./types";
export { estimateCostUsd, PRICES_AS_OF } from "./pricing";

/** The configured provider. Provider and model always come from env, never code. */
export function getLlm(): LlmProvider {
  const e = env();
  if (!e.LLM_MODEL) throw new LlmError("config", "LLM_MODEL isn't set, so AI import is off. Set it (e.g. gemini-3.8-flash).");
  if (e.LLM_PROVIDER === "gemini") {
    if (!e.GEMINI_API_KEY) throw new LlmError("config", "GEMINI_API_KEY isn't set, so AI import is off.");
    const fallbacks = (e.LLM_FALLBACK_MODEL ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    return new GeminiProvider(e.GEMINI_API_KEY, e.LLM_MODEL, fallbacks);
  }
  // The interface is ready for Claude; the adapter (and @anthropic-ai/sdk) is a v2 item.
  throw new LlmError("config", `LLM_PROVIDER=${e.LLM_PROVIDER} isn't supported yet. Use gemini.`);
}
