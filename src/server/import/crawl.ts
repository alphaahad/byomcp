/**
 * Crawl planning and chunking for the AI import. Pure functions.
 */

export const DEFAULT_MAX_PAGES = 10;
export const HARD_MAX_PAGES = 25;
export const CHUNK_MAX_CHARS = 40_000; // ~10k tokens
export const TOTAL_MAX_CHARS = 600_000; // ~150k tokens across all pages

const SKIP_PATH = /\/(login|logout|signin|signup|register|search|changelog|blog|pricing|careers|legal|privacy|terms|status|community|discuss|support)(\/|$)/i;

/**
 * Which links to follow from the start page: same origin, same top-level docs
 * section as the start page (e.g. /reference/...), in page order (docs sidebars
 * list endpoints in reading order), excluding non-docs pages.
 */
export function selectCrawlLinks(startUrl: string, links: string[], maxPages: number): string[] {
  const start = new URL(startUrl);
  const section = start.pathname.split("/").filter(Boolean)[0];
  const picked: string[] = [];
  const seen = new Set([normalize(start)]);
  // Neighbours first: docs sidebars group related endpoints, so start from the
  // start page's own position in the nav and wrap around.
  const here = links.findIndex((l) => {
    try {
      return normalize(new URL(l)) === normalize(start);
    } catch {
      return false;
    }
  });
  const ordered = here >= 0 ? [...links.slice(here + 1), ...links.slice(0, here)] : links;
  for (const raw of ordered) {
    if (picked.length >= maxPages - 1) break;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.origin !== start.origin || SKIP_PATH.test(url.pathname)) continue;
    if (section && url.pathname.split("/").filter(Boolean)[0] !== section) continue;
    const key = normalize(url);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(url.toString());
  }
  return picked;
}

function normalize(url: URL): string {
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

export type PageSegment = { url: string | null; text: string };
export type Chunk = { segments: PageSegment[] };

/**
 * Pack pages into chunks of at most CHUNK_MAX_CHARS. Small pages share a chunk
 * (fewer AI calls); big pages are split at headings, then paragraphs.
 * Each segment keeps its source URL so citations point at the right page.
 */
export function chunkPages(pages: PageSegment[], maxChars = CHUNK_MAX_CHARS): Chunk[] {
  const pieces: PageSegment[] = [];
  for (const page of pages) {
    for (const part of splitText(page.text, maxChars)) pieces.push({ url: page.url, text: part });
  }
  const chunks: Chunk[] = [];
  let current: PageSegment[] = [];
  let size = 0;
  for (const piece of pieces) {
    if (size + piece.text.length > maxChars && current.length) {
      chunks.push({ segments: current });
      current = [];
      size = 0;
    }
    current.push(piece);
    size += piece.text.length;
  }
  if (current.length) chunks.push({ segments: current });
  return chunks;
}

function splitText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return text.trim() ? [text] : [];
  // Split before headings, then pack sections; oversized sections split by paragraph, then hard.
  const sections = text.split(/\n(?=#{1,6} )/);
  const out: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.trim()) out.push(buf);
    buf = "";
  };
  for (const section of sections) {
    const parts = section.length > maxChars ? section.split(/\n\n+/) : [section];
    for (let part of parts) {
      while (part.length > maxChars) {
        flush();
        out.push(part.slice(0, maxChars));
        part = part.slice(maxChars);
      }
      if (buf.length + part.length + 1 > maxChars) flush();
      buf = buf ? `${buf}\n${part}` : part;
    }
  }
  flush();
  return out;
}
