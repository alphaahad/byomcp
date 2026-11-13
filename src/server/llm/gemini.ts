import "server-only";
import { ApiError, FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel, type Content, type GenerateContentConfig, type Part } from "@google/genai";
import { LlmError, type ChatRequest, type ChatResponse, type ChatStep, type LlmJsonRequest, type LlmJsonResponse, type LlmProvider } from "./types";

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 50_000;

/**
 * Gemini via the official SDK, using JSON-schema structured output.
 * Retries 429/5xx with backoff; if the primary model is still overloaded or
 * out of quota (429/503/504), tries each fallback model once, in order. `model` reports the
 * model that actually answered, so cost is priced correctly.
 */
export class GeminiProvider implements LlmProvider {
  readonly provider = "gemini" as const;
  private readonly client: GoogleGenAI;
  model: string;

  constructor(
    apiKey: string,
    private readonly primaryModel: string,
    /** Tried in order when the one before is overloaded or out of quota. */
    private readonly fallbackModels: string[] = [],
  ) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = primaryModel;
  }

  async generateJson(req: LlmJsonRequest): Promise<LlmJsonResponse> {
    return this.withFallbacks((model, first) => this.withRetries(model, req, first ? MAX_ATTEMPTS : 1));
  }

  /**
   * Main model first (with retries); if it's overloaded or its quota is used up
   * (free-tier quotas are per model), each fallback model gets one try in turn.
   */
  private async withFallbacks<T>(run: (model: string, first: boolean) => Promise<T>): Promise<T> {
    const models = [this.primaryModel, ...this.fallbackModels.filter((m) => m !== this.primaryModel)];
    let lastErr: unknown;
    for (const [i, model] of models.entries()) {
      try {
        return await run(model, i === 0);
      } catch (err) {
        lastErr = err;
        const moveOn = err instanceof ApiError && (err.status === 429 || err.status === 503 || err.status === 504);
        if (!moveOn) break;
      }
    }
    throw toLlmError(lastErr);
  }

  /**
   * The test chat's function-calling loop. Each model turn is appended to the
   * history unchanged (Gemini 3 needs its thought signatures back); all tool
   * results for a turn go back together in one user turn, matched by call id.
   */
  async chatWithTools(req: ChatRequest): Promise<ChatResponse> {
    const contents: Content[] = req.messages.map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] }));
    const config: GenerateContentConfig = {
      systemInstruction: req.system,
      tools: req.tools.length
        ? [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description.slice(0, 1000), parametersJsonSchema: t.inputSchema })) }]
        : undefined,
      toolConfig: req.tools.length ? { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } } : undefined,
      temperature: 0,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      abortSignal: req.signal,
      httpOptions: { timeout: REQUEST_TIMEOUT_MS },
    };
    const usage = { inputTokens: 0, outputTokens: 0 };
    const steps: ChatStep[] = [];

    for (;;) {
      const res = await this.generate(contents, config, req.signal);
      const u = res.usageMetadata ?? {};
      usage.inputTokens += u.promptTokenCount ?? 0;
      usage.outputTokens += (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
      const content = res.candidates?.[0]?.content;
      if (content) contents.push(content);

      const calls = res.functionCalls ?? [];
      if (calls.length === 0) return { answer: res.text?.trim() || "(No answer.)", steps, usage, stoppedEarly: false };
      if (steps.length + calls.length > req.maxToolCalls) {
        return { answer: res.text?.trim() || "I'd need more steps than this test allows. Try a narrower question.", steps, usage, stoppedEarly: true };
      }

      const parts: Part[] = [];
      for (const call of calls) {
        const name = call.name ?? "";
        const args = (call.args ?? {}) as Record<string, unknown>;
        const r = await req.callTool(name, args);
        steps.push({ tool: name, args, result: r.display ?? r.text, isError: r.isError });
        parts.push({ functionResponse: { id: call.id, name, response: r.isError ? { error: r.text } : { result: r.text } } });
      }
      contents.push({ role: "user", parts });
    }
  }

  /** One generateContent call, with the same retries and fallback as extraction. */
  private async generate(contents: Content[], config: GenerateContentConfig, signal?: AbortSignal) {
    const once = async (model: string, attempts: number) => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const res = await this.client.models.generateContent({ model, contents, config });
          this.model = model;
          return res;
        } catch (err) {
          lastError = err;
          const status = err instanceof ApiError ? err.status : undefined;
          const retryable = status === 429 || (status !== undefined && status >= 500);
          if (!retryable || attempt === attempts || signal?.aborted) break;
          await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1) + Math.random() * 250));
        }
      }
      throw lastError;
    };
    return this.withFallbacks((model, first) => once(model, first ? MAX_ATTEMPTS : 1));
  }

  private async withRetries(model: string, req: LlmJsonRequest, attempts = MAX_ATTEMPTS): Promise<LlmJsonResponse> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await this.client.models.generateContent({
          model,
          contents: req.prompt,
          config: {
            systemInstruction: req.system,
            responseMimeType: "application/json",
            responseJsonSchema: req.jsonSchema,
            maxOutputTokens: req.maxOutputTokens ?? 16_384,
            // Extraction is reading, not reasoning: keep thinking (billed as output) low.
            // (gemini-3.8-flash rejects MINIMAL with a 400, checked 2026-11-13.)
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            abortSignal: req.signal,
            httpOptions: { timeout: REQUEST_TIMEOUT_MS },
          },
        });
        const text = res.text;
        if (!text) {
          const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? "empty";
          throw new LlmError("refused", `The AI returned no answer (${reason}).`);
        }
        const u = res.usageMetadata ?? {};
        this.model = model;
        return {
          text,
          usage: {
            inputTokens: u.promptTokenCount ?? 0,
            outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
          },
        };
      } catch (err) {
        lastError = err;
        const status = err instanceof ApiError ? err.status : undefined;
        const retryable = status === 429 || (status !== undefined && status >= 500);
        if (!retryable || attempt === attempts || req.signal?.aborted) break;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1) + Math.random() * 250));
      }
    }
    throw lastError;
  }
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof ApiError) {
    if (err.status === 429) return new LlmError("rate_limited", "The AI service is at its limit. Wait a minute and try again. If it keeps happening, today's free AI allowance is used up: try again tomorrow, or use a link to an OpenAPI file (no AI needed).");
    if (err.status === 401 || err.status === 403) {
      return new LlmError("config", "The Gemini API key was rejected. Check GEMINI_API_KEY.");
    }
    if (err.status >= 500) return new LlmError("unavailable", "The AI service is overloaded right now. Try again in a few minutes.");
    return new LlmError("bad_request", `The AI service rejected the request (HTTP ${err.status}): ${err.message.slice(0, 300)}`);
  }
  return new LlmError("unavailable", "Couldn't reach the AI service.");
}
