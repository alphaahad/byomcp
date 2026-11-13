/**
 * Provider-neutral LLM interface. Used at build time (docs extraction) and in
 * the "Talk to it" test chat. The MCP runtime itself never calls an LLM.
 * Provider and model come from env.
 */

export type LlmUsage = { inputTokens: number; outputTokens: number };

export type LlmJsonRequest = {
  system: string;
  prompt: string;
  /** JSON Schema for the response (keep to the subset every provider supports). */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type LlmJsonResponse = { text: string; usage: LlmUsage };

/** A tool the model may call: the MCP tool's name, description and JSON Schema input. */
export type ChatTool = { name: string; description: string; inputSchema: Record<string, unknown> };

export type ChatStep = { tool: string; args: Record<string, unknown>; result: string; isError: boolean };

export type ChatRequest = {
  system: string;
  /** Earlier turns, as plain text (tool details aren't replayed). The last one is the new user message. */
  messages: { role: "user" | "assistant"; text: string }[];
  tools: ChatTool[];
  /** Hard cap on tool calls for this message. */
  maxToolCalls: number;
  /** Runs one tool call for real. `text` is what the model sees (may be cut short); `display` is the fuller copy for the screen. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean; display?: string }>;
  signal?: AbortSignal;
};

export type ChatResponse = { answer: string; steps: ChatStep[]; usage: LlmUsage; stoppedEarly: boolean };

export interface LlmProvider {
  readonly provider: "gemini" | "anthropic" | "fake";
  model: string; // the model that answered the last call (may be the fallback)
  generateJson(req: LlmJsonRequest): Promise<LlmJsonResponse>;
  /** Function-calling loop for the test chat. */
  chatWithTools(req: ChatRequest): Promise<ChatResponse>;
}

export type LlmErrorCode = "config" | "rate_limited" | "unavailable" | "refused" | "bad_request";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
