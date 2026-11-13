import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chunkPages, selectCrawlLinks } from "./crawl";
import { htmlToText } from "./html-to-text";

const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", name), "utf8");

describe("htmlToText", () => {
  const page = htmlToText(fixture("docs-page.html"), "https://docs.example.com/reference/create-ticket");

  it("keeps the article and drops chrome", () => {
    expect(page.title).toBe("Create a ticket");
    expect(page.text).toContain("# Create a ticket");
    expect(page.text).toContain("POST https://api.example.com/v2/tickets");
    expect(page.text).not.toContain("Sidebar link text");
    expect(page.text).not.toContain("tracking()");
    expect(page.text).not.toContain("Footer");
  });

  it("renders code blocks without inner tags, and tables as rows", () => {
    expect(page.text).toContain("```\ncurl -X POST https://api.example.com/v2/tickets \\\n  -u API_KEY:x\n```");
    expect(page.text).not.toContain("<code");
    expect(page.text).toContain("| subject | string | Yes | The ticket subject |");
  });

  it("collects same-origin links in order, and OpenAPI links", () => {
    expect(page.links.slice(0, 3)).toEqual([
      "https://docs.example.com/reference/list-tickets",
      "https://docs.example.com/reference/create-ticket",
      "https://docs.example.com/reference/delete-ticket",
    ]);
    expect(page.links.some((l) => l.includes("other.example.com"))).toBe(false);
    expect(page.openApiLinks).toEqual(["https://docs.example.com/files/openapi.json"]);
  });
});

describe("selectCrawlLinks", () => {
  const start = "https://docs.example.com/reference/create-ticket";
  const links = [
    "https://docs.example.com/reference/list-tickets",
    "https://docs.example.com/reference/create-ticket", // the start page itself
    "https://docs.example.com/reference/delete-ticket/",
    "https://docs.example.com/reference/delete-ticket",
    "https://docs.example.com/docs/getting-started", // other section
    "https://docs.example.com/login?redirect_uri=/reference",
    "https://other.example.com/reference/x",
    "https://docs.example.com/reference/get-ticket",
  ];

  it("stays in the start page's section, dedupes, starts from the start page's neighbours, and respects the cap", () => {
    expect(selectCrawlLinks(start, links, 10)).toEqual([
      "https://docs.example.com/reference/delete-ticket/",
      "https://docs.example.com/reference/get-ticket",
      "https://docs.example.com/reference/list-tickets",
    ]);
    expect(selectCrawlLinks(start, links, 2)).toEqual(["https://docs.example.com/reference/delete-ticket/"]);
  });

  it("falls back to page order when the start page isn't in the nav", () => {
    expect(selectCrawlLinks("https://docs.example.com/reference", links, 2)).toEqual([
      "https://docs.example.com/reference/list-tickets",
    ]);
  });
});

describe("chunkPages", () => {
  it("packs small pages together and keeps each page's URL", () => {
    const chunks = chunkPages(
      [
        { url: "https://a/1", text: "# One\nGET /one" },
        { url: "https://a/2", text: "# Two\nGET /two" },
      ],
      1000,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0].segments.map((s) => s.url)).toEqual(["https://a/1", "https://a/2"]);
  });

  it("splits a big page at headings and never exceeds the limit", () => {
    const big = Array.from({ length: 40 }, (_, i) => `## Section ${i}\n${"word ".repeat(60)}`).join("\n");
    const chunks = chunkPages([{ url: null, text: big }], 1000);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) for (const s of c.segments) expect(s.text.length).toBeLessThanOrEqual(1000);
    expect(chunks[1].segments[0].text.startsWith("## Section")).toBe(true);
  });

  it("hard-splits a single giant paragraph", () => {
    const chunks = chunkPages([{ url: null, text: "x".repeat(2500) }], 1000);
    expect(chunks.flatMap((c) => c.segments).map((s) => s.text.length)).toEqual([1000, 1000, 500]);
  });
});
