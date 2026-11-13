/**
 * Docs page HTML → compact Markdown-ish text for the extractor, plus the links
 * we may crawl and any OpenAPI file the page links to.
 * Keeps what carries API facts (headings, code blocks, tables, lists) and drops
 * chrome (nav, sidebars, footers, scripts). Pure: no network.
 */
import { NodeType, parse, type HTMLElement, type Node } from "node-html-parser";

const DROP = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "nav",
  "footer",
  "aside",
  "form",
  "iframe",
  "button",
  "select",
  "template",
  "head",
  "img",
  "picture",
  "video",
]);
const BLOCK = new Set([
  "p",
  "div",
  "section",
  "article",
  "main",
  "header",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "blockquote",
  "figure",
  "figcaption",
  "details",
  "summary",
]);
const DROP_ROLES = new Set(["navigation", "banner", "contentinfo", "search", "complementary"]);
const MAIN_SELECTORS = ["main", "[role=main]", "article", "#content", ".content", ".markdown-body"];

export type PageText = {
  title: string;
  text: string;
  links: string[]; // absolute, same-origin, no fragment, in page order
  openApiLinks: string[]; // links that look like OpenAPI/Swagger files
};

function isElement(n: Node): n is HTMLElement {
  return n.nodeType === NodeType.ELEMENT_NODE;
}

function shouldDrop(el: HTMLElement): boolean {
  const tag = el.tagName?.toLowerCase();
  if (!tag || DROP.has(tag)) return true;
  const role = el.getAttribute("role");
  if (role && DROP_ROLES.has(role)) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  if (el.getAttribute("hidden") !== undefined) return true;
  return false;
}

const collapse = (s: string) => s.replace(/[ \t\f\v ]+/g, " ");

function render(node: Node, out: string[]): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    out.push(collapse(node.text));
    return;
  }
  if (!isElement(node) || shouldDrop(node)) return;
  const tag = node.tagName.toLowerCase();

  const heading = tag.match(/^h([1-6])$/);
  if (heading) {
    const text = collapse(node.text).trim();
    if (text) out.push(`\n\n${"#".repeat(Number(heading[1]))} ${text}\n\n`);
    return;
  }
  switch (tag) {
    case "pre": {
      const code = node.text.replace(/\n{3,}/g, "\n\n").trimEnd();
      if (code.trim()) out.push(`\n\n\`\`\`\n${code}\n\`\`\`\n\n`);
      return;
    }
    case "code": {
      const code = collapse(node.text).trim();
      if (code) out.push(`\`${code}\``);
      return;
    }
    case "br":
      out.push("\n");
      return;
    case "li": {
      const inner: string[] = [];
      node.childNodes.forEach((c) => render(c, inner));
      const text = inner.join("").replace(/\n{2,}/g, "\n").trim();
      if (text) out.push(`\n- ${text.replace(/\n/g, "\n  ")}`);
      return;
    }
    case "table": {
      const rows = node.querySelectorAll("tr").map((tr) =>
        tr
          .querySelectorAll("th, td")
          .map((cell) => collapse(cell.text).trim().replace(/\|/g, "\\|"))
          .join(" | "),
      );
      const kept = rows.filter((r) => r.replace(/[\s|]/g, ""));
      if (kept.length) out.push(`\n\n${kept.map((r) => `| ${r} |`).join("\n")}\n\n`);
      return;
    }
  }
  const block = BLOCK.has(tag);
  if (block) out.push("\n");
  node.childNodes.forEach((c) => render(c, out));
  if (block) out.push("\n");
}

function pickRoot(doc: HTMLElement): HTMLElement {
  for (const sel of MAIN_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el && collapse(el.text).trim().length > 200) return el;
  }
  return doc.querySelector("body") ?? doc;
}

const OPENAPI_LINK = /(openapi|swagger|oas)[^/]*\.(json|ya?ml)(\?|$)|\/(openapi|swagger)(\.json|\.ya?ml)?(\?|$)/i;
const SKIP_EXT = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|map|pdf|zip|gz|mp4|woff2?|ttf)(\?|$)/i;

export function htmlToText(html: string, pageUrl: string): PageText {
  // pre is parsed (not kept raw) so <code> wrappers inside it are stripped; its text nodes keep their whitespace.
  const doc = parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false } });
  const base = new URL(pageUrl);
  const title = collapse(doc.querySelector("title")?.text ?? "").trim();

  const links: string[] = [];
  const openApiLinks: string[] = [];
  const seen = new Set<string>();
  // Links come from the whole page (the sidebar is how docs sites list endpoints).
  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    url.hash = "";
    const abs = url.toString();
    if (OPENAPI_LINK.test(url.pathname + url.search) && url.protocol === "https:" && !openApiLinks.includes(abs)) {
      openApiLinks.push(abs);
    }
    if (url.origin !== base.origin || SKIP_EXT.test(url.pathname) || seen.has(abs)) continue;
    seen.add(abs);
    links.push(abs);
  }

  const out: string[] = [];
  render(pickRoot(doc), out);
  const text = out
    .join("")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text, links, openApiLinks };
}
