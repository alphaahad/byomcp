import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type FakeResponse = { functionCalls?: { id: string; name: string; args: Record<string, unknown> }[]; text?: string };

async function providerWith(responses: FakeResponse[]) {
  const { GeminiProvider } = await import("./gemini");
  const p = new GeminiProvider("test-key", "test-model");
  const seen: unknown[][] = [];
  let i = 0;
  // Replace the network call: each turn returns the next scripted response.
  (p as unknown as { generate: (contents: unknown[]) => Promise<unknown> }).generate = async (contents: unknown[]) => {
    seen.push(structuredClone(contents));
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      functionCalls: r.functionCalls,
      text: r.text,
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      candidates: [{ content: { role: "model", parts: [...(r.functionCalls ?? []).map((c) => ({ functionCall: c }) as unknown), ...(r.text ? [{ text: r.text }] : [])] } }],
    };
  };
  return { p, seen };
}

const base = { system: "s", messages: [{ role: "user" as const, text: "hi" }], tools: [{ name: "list", description: "d", inputSchema: {} }] };

describe("chatWithTools loop", () => {
  it("runs tool calls, returns results in one turn by id, then answers", async () => {
    const { p, seen } = await providerWith([
      { functionCalls: [{ id: "a", name: "list", args: {} }, { id: "b", name: "list", args: { page: 2 } }] },
      { text: "Here you go." },
    ]);
    const callTool = vi.fn(async (name: string) => ({ text: `[${name}]`, isError: false }));
    const res = await p.chatWithTools({ ...base, maxToolCalls: 5, callTool });
    expect(res.answer).toBe("Here you go.");
    expect(res.steps.map((s) => s.args)).toEqual([{}, { page: 2 }]);
    expect(res.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    // Second request: user msg, model turn (unchanged), ONE user turn with both results, ids kept.
    const second = seen[1] as { role: string; parts: { functionResponse?: { id: string } }[] }[];
    expect(second.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(second[2].parts.map((x) => x.functionResponse?.id)).toEqual(["a", "b"]);
  });

  it("stops at the tool-call cap instead of looping forever", async () => {
    const { p } = await providerWith([{ functionCalls: [{ id: "x", name: "list", args: {} }, { id: "y", name: "list", args: {} }] }]);
    const callTool = vi.fn(async () => ({ text: "ok", isError: false }));
    const res = await p.chatWithTools({ ...base, maxToolCalls: 5, callTool });
    expect(res.stoppedEarly).toBe(true);
    expect(callTool).toHaveBeenCalledTimes(4); // 2 + 2; a third pair would exceed 5
  });

  it("passes tool errors back as errors", async () => {
    const { p, seen } = await providerWith([{ functionCalls: [{ id: "e", name: "list", args: {} }] }, { text: "It failed." }]);
    await p.chatWithTools({ ...base, maxToolCalls: 5, callTool: async () => ({ text: "HTTP 500", isError: true }) });
    const last = seen[1] as { parts: { functionResponse?: { response: unknown } }[] }[];
    expect(last[2].parts[0].functionResponse?.response).toEqual({ error: "HTTP 500" });
  });
});
