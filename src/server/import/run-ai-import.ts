import "server-only";
/**
 * AI import (docs page link or pasted text), run as short resumable steps:
 *
 *   fetching   → start page, then same-section links (≤ maxPages), 4 per step
 *   extracting → up to 3 chunks per step, one LLM call each (in parallel)
 *   merging    → dedupe, vote base URL/auth, save actions + cost on the version
 *
 * Each step stays well under any function time limit. The progress page drives
 * the steps; a DB lease makes concurrent callers (two tabs) harmless.
 * Doc text lives in the DB only until the import finishes, then it's cleared.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { defaultRequiresApproval, initialEnabled } from "@/lib/ir";
import type { DetectedConfig } from "@/lib/import-types";
import { db } from "@/server/db";
import { actions, connectorVersions, connectors, importChunks, importJobs } from "@/server/db/schema";
import { LlmError, estimateCostUsd, getLlm } from "@/server/llm";
import { SafeFetchError, assertSafeUrl, safeFetch } from "@/server/net/safe-fetch";
import {
  EXTRACTION_JSON_SCHEMA,
  SYSTEM_PROMPT,
  buildPrompt,
  mergeCandidates,
  parseExtraction,
  toCandidates,
  voteDetected,
  type ChunkResult,
} from "./ai-extract";
import { CHUNK_MAX_CHARS, DEFAULT_MAX_PAGES, HARD_MAX_PAGES, TOTAL_MAX_CHARS, chunkPages, selectCrawlLinks, type Chunk } from "./crawl";
import { htmlToText } from "./html-to-text";
import { GUEST_AI_IMPORTS_PER_DAY, GUEST_MAX_APPS, TOO_MANY_APPS, aiImportsLastDay, appCount } from "@/server/workspaces/workspaces";
import { slugify } from "./run-openapi-import";

export const MAX_PASTED_CHARS = 200_000;
const LEASE_SECONDS = 90;
const FETCH_PER_STEP = 4;
const CHUNKS_PER_STEP = 3;
const MAX_CHUNK_ATTEMPTS = 3;
const PAGE_MAX_BYTES = 3 * 1024 * 1024;

export type AiSource = { kind: "docs_url"; url: string; maxPages?: number } | { kind: "text"; text: string };

export type ImportProgress = {
  jobId: string;
  connectorId: string;
  stage: "fetching" | "extracting" | "merging" | "done" | "failed";
  pagesRead: number;
  pagesPlanned: number;
  chunksTotal: number;
  chunksDone: number;
  actionsFound: number;
  costUsd: number | null;
  costKnown: boolean;
  error: string | null;
  warnings: string[];
  openApiLinks: string[];
};

type Job = typeof importJobs.$inferSelect;

/* Start ----------------------------------------------------------------- */

export async function startAiImport(input: { workspaceId: string; isOwner?: boolean; name?: string; source: AiSource }): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  if (!input.isOwner && (await appCount(input.workspaceId)) >= GUEST_MAX_APPS) return { ok: false, error: TOO_MANY_APPS };
  if (!input.isOwner && (await aiImportsLastDay(input.workspaceId)) >= GUEST_AI_IMPORTS_PER_DAY) {
    return {
      ok: false,
      error: `This workspace has used its ${GUEST_AI_IMPORTS_PER_DAY} AI imports for today. OpenAPI files don't use AI, so a link to one still works; or try again tomorrow.`,
    };
  }
  let llm;
  try {
    llm = getLlm(); // fail before creating anything if AI import isn't configured
  } catch (err) {
    return { ok: false, error: err instanceof LlmError ? err.message : "AI import isn't set up." };
  }

  const { source } = input;
  let startUrl: string | null = null;
  let chunks: Chunk[] = [];
  if (source.kind === "docs_url") {
    try {
      startUrl = assertSafeUrl(source.url).toString();
    } catch (err) {
      return { ok: false, error: err instanceof SafeFetchError ? err.message : "That link isn't valid." };
    }
  } else {
    const text = source.text.trim();
    if (text.length < 40) return { ok: false, error: "Paste a bit more of the docs. We need at least a few lines that describe the API." };
    if (text.length > MAX_PASTED_CHARS) {
      return { ok: false, error: "That's more than 200,000 characters. Paste just the API reference part, or use a docs link." };
    }
    chunks = chunkPages([{ url: null, text }]);
  }

  const name = (input.name?.trim() || (startUrl ? new URL(startUrl).hostname.replace(/^(www|docs|developers?|documentation|api)\./, "") : "New app")).slice(0, 80);
  const connectorId = randomUUID();
  const versionId = randomUUID();
  const jobId = randomUUID();
  const maxPages = Math.min(Math.max(1, source.kind === "docs_url" ? source.maxPages ?? DEFAULT_MAX_PAGES : 1), HARD_MAX_PAGES);
  const d = db();

  await d.batch([
    d.insert(connectors).values({ id: connectorId, workspaceId: input.workspaceId, name, slug: slugify(name) }),
    d.insert(connectorVersions).values({
      id: versionId,
      connectorId,
      version: 1,
      sourceType: source.kind,
      sourceRef: startUrl ?? "Pasted text",
      llmProvider: llm.provider,
      llmModel: llm.model,
    }),
    d.insert(importJobs).values({
      id: jobId,
      connectorId,
      versionId,
      status: "running",
      stage: startUrl ? "fetching" : "extracting",
      startUrl,
      maxPages,
      pendingUrls: startUrl ? [startUrl] : [],
      chunksTotal: chunks.length,
      costUsd: "0",
    }),
    ...(chunks.length
      ? [d.insert(importChunks).values(chunks.map((c, seq) => ({ jobId, seq, segments: c.segments })))]
      : []),
  ]);
  // Many requests at once could all pass the check above: count again now that this one is saved.
  if (!input.isOwner && (await aiImportsLastDay(input.workspaceId)) > GUEST_AI_IMPORTS_PER_DAY) {
    await d.delete(connectors).where(eq(connectors.id, connectorId));
    return { ok: false, error: `This workspace has used its ${GUEST_AI_IMPORTS_PER_DAY} AI imports for today. Try again tomorrow, or use a link to an OpenAPI file (no AI needed).` };
  }
  return { ok: true, jobId };
}

/* Step ------------------------------------------------------------------- */

async function claim(jobId: string): Promise<Job | null> {
  const [job] = await db()
    .update(importJobs)
    .set({ leaseUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})` })
    .where(and(eq(importJobs.id, jobId), or(isNull(importJobs.leaseUntil), lt(importJobs.leaseUntil, sql`now()`))))
    .returning();
  return job ?? null;
}

async function release(jobId: string, patch: Partial<typeof importJobs.$inferInsert> = {}) {
  await db().update(importJobs).set({ ...patch, leaseUntil: null }).where(eq(importJobs.id, jobId));
}

async function fail(job: Job, message: string) {
  await release(job.id, { stage: "failed", status: "failed", error: message, finishedAt: new Date(), pages: [] });
  await db().update(importChunks).set({ segments: null }).where(eq(importChunks.jobId, job.id));
}

/** Advance the import by one short step. Safe to call concurrently and repeatedly. */
export async function stepAiImport(jobId: string): Promise<ImportProgress | null> {
  const job = await claim(jobId);
  if (job && job.stage !== "done" && job.stage !== "failed") {
    try {
      if (job.stage === "fetching") await stepFetch(job);
      else if (job.stage === "extracting") await stepExtract(job);
      else if (job.stage === "merging") await stepMerge(job);
    } catch (err) {
      console.error("AI import step failed", jobId, err instanceof Error ? err.message : err);
      await fail(job, "Something went wrong while reading the docs. Try again, or paste the docs text instead.");
    }
  } else if (job) {
    await release(job.id);
  }
  return getImportProgress(jobId);
}

/* Fetching --------------------------------------------------------------- */

async function fetchPage(url: string): Promise<{ url: string; text: string; links: string[]; openApiLinks: string[] }> {
  const res = await safeFetch(url, { maxBytes: PAGE_MAX_BYTES, headers: { accept: "text/html, text/plain;q=0.9, */*;q=0.5" } });
  if (res.status < 200 || res.status >= 300) {
    throw new SafeFetchError("network", `The page returned an error (HTTP ${res.status}).`);
  }
  const body = res.text();
  const type = String(res.headers["content-type"] ?? "");
  if (/json|yaml/i.test(type) || /^\s*(\{\s*"(openapi|swagger)"|(openapi|swagger)\s*:)/.test(body)) {
    throw new SafeFetchError("invalid_url", "OPENAPI_FILE");
  }
  if (/html/i.test(type) || /^\s*</.test(body)) {
    const page = htmlToText(body, res.url);
    return { url: res.url, text: page.text, links: page.links, openApiLinks: page.openApiLinks };
  }
  return { url: res.url, text: body, links: [], openApiLinks: [] };
}

async function stepFetch(job: Job) {
  const isFirst = job.pagesRead === 0;
  const batch = isFirst ? job.pendingUrls.slice(0, 1) : job.pendingUrls.slice(0, FETCH_PER_STEP);
  let pending = job.pendingUrls.slice(batch.length);
  const pages = [...job.pages];
  const warnings = [...job.warnings];
  let openApiLinks = job.openApiLinks;
  let total = pages.reduce((n, p) => n + p.text.length, 0);

  const results = await Promise.allSettled(batch.map(fetchPage));
  for (const [i, r] of results.entries()) {
    if (r.status === "rejected") {
      const msg = r.reason instanceof SafeFetchError ? r.reason.message : "Couldn't read the page.";
      if (isFirst) {
        if (msg === "OPENAPI_FILE") {
          return fail(job, "This link is an OpenAPI file, not a docs page. Use the \"OpenAPI file\" option instead: it's free and more accurate.");
        }
        return fail(job, `We couldn't read that page: ${msg}`);
      }
      warnings.push(`Skipped ${batch[i]}: ${msg === "OPENAPI_FILE" ? "it's an OpenAPI file" : msg}`);
      continue;
    }
    const page = r.value;
    if (isFirst) {
      pending = selectCrawlLinks(page.url, page.links, job.maxPages);
      openApiLinks = page.openApiLinks;
    }
    if (pages.some((p) => p.url === page.url)) continue; // two links redirected to the same page
    if (!page.text.trim()) {
      warnings.push(`${page.url} had no readable text (it may need JavaScript to show its content).`);
      continue;
    }
    if (total + page.text.length > TOTAL_MAX_CHARS) {
      warnings.push("Stopped reading more pages: we'd reached the size limit for one import.");
      pending = [];
      break;
    }
    total += page.text.length;
    pages.push({ url: page.url, text: page.text });
  }

  const pagesRead = job.pagesRead + batch.length;
  if (pending.length > 0) {
    return release(job.id, { pendingUrls: pending, pages, pagesRead, warnings, openApiLinks });
  }
  if (pages.length === 0) {
    return fail(job, "We couldn't read any text from those pages. If the docs need JavaScript to load, paste the text instead.");
  }
  const chunks = chunkPages(pages, CHUNK_MAX_CHARS);
  await db().insert(importChunks).values(chunks.map((c, seq) => ({ jobId: job.id, seq, segments: c.segments })));
  await release(job.id, {
    stage: "extracting",
    pendingUrls: [],
    pages: [],
    pagesRead,
    warnings,
    openApiLinks,
    chunksTotal: chunks.length,
  });
}

/* Extracting -------------------------------------------------------------- */

async function stepExtract(job: Job) {
  const d = db();
  const pending = await d
    .select()
    .from(importChunks)
    .where(and(eq(importChunks.jobId, job.id), eq(importChunks.status, "pending")))
    .orderBy(asc(importChunks.seq))
    .limit(CHUNKS_PER_STEP);

  if (pending.length === 0) return release(job.id, { stage: "merging" });

  const llm = getLlm();
  const outcomes = await Promise.allSettled(
    pending.map(async (chunk) => {
      const segments = chunk.segments ?? [];
      const res = await llm.generateJson({
        system: SYSTEM_PROMPT,
        prompt: buildPrompt({ segments }),
        jsonSchema: EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>,
      });
      const result: ChunkResult = toCandidates(parseExtraction(res.text), { segments });
      return { chunk, result, usage: res.usage, model: llm.model };
    }),
  );

  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;
  let costKnown = job.costKnown;
  let done = 0;
  let found = 0;
  for (const [i, o] of outcomes.entries()) {
    const chunk = pending[i];
    if (o.status === "fulfilled") {
      const c = estimateCostUsd(o.value.model, o.value.usage);
      if (c === null) costKnown = false;
      tokensIn += o.value.usage.inputTokens;
      tokensOut += o.value.usage.outputTokens;
      cost += c ?? 0;
      done++;
      found += o.value.result.candidates.length;
      await d
        .update(importChunks)
        .set({
          status: "done",
          result: o.value.result,
          model: o.value.model,
          tokensIn: o.value.usage.inputTokens,
          tokensOut: o.value.usage.outputTokens,
          costUsd: c === null ? null : c.toFixed(6),
          attempts: chunk.attempts + 1,
        })
        .where(eq(importChunks.id, chunk.id));
      continue;
    }
    const err = o.reason;
    if (err instanceof LlmError && err.code === "config") return fail(job, err.message);
    const attempts = chunk.attempts + 1;
    const message = err instanceof LlmError ? err.message : "The AI step failed.";
    const giveUp = attempts >= MAX_CHUNK_ATTEMPTS || (err instanceof LlmError && (err.code === "bad_request" || err.code === "refused"));
    await d
      .update(importChunks)
      .set({ attempts, error: message, status: giveUp ? "failed" : "pending" })
      .where(eq(importChunks.id, chunk.id));
    if (giveUp) done++;
  }

  await release(job.id, {
    chunksDone: job.chunksDone + done,
    actionsFound: job.actionsFound + found,
    tokensIn: job.tokensIn + tokensIn,
    tokensOut: job.tokensOut + tokensOut,
    costUsd: (Number(job.costUsd ?? 0) + cost).toFixed(6),
    costKnown,
  });
}

/* Merging ------------------------------------------------------------------ */

async function stepMerge(job: Job) {
  const d = db();
  const rows = await d.select().from(importChunks).where(eq(importChunks.jobId, job.id)).orderBy(asc(importChunks.seq));
  const results = rows.filter((r) => r.status === "done" && r.result).map((r) => r.result as ChunkResult);
  const failedChunks = rows.filter((r) => r.status === "failed");
  const merged = mergeCandidates(results.flatMap((r) => r.candidates));

  if (merged.length === 0) {
    const why = failedChunks.length
      ? `The AI service failed on ${failedChunks.length} of ${rows.length} parts (${failedChunks[0].error}). Try again in a few minutes.`
      : `We read ${job.pagesRead || "the"} page${job.pagesRead === 1 ? "" : "s"} but didn't find any API endpoints. Try the API reference page itself, or paste its text.`;
    return fail(job, why);
  }

  const voted = voteDetected(results);
  const warnings = [...job.warnings];
  if (failedChunks.length) warnings.push(`The AI couldn't read ${failedChunks.length} of ${rows.length} parts of the docs, so some actions may be missing.`);
  const dropped = results.reduce((n, r) => n + r.dropped, 0);
  if (dropped) warnings.push(`${dropped} AI suggestions were thrown out because they didn't match the expected format.`);
  if (voted.auth.type === "unsupported") {
    warnings.push(`The docs describe ${voted.auth.scheme}, which isn't supported yet. You can still connect with an API key or token if the app offers one.`);
  }
  const needsReview = merged.filter((m) => m.evidence === "needs_review").length;
  if (needsReview) warnings.push(`${needsReview} actions need review: we couldn't match them to an exact quote in the docs.`);

  const [version] = await d.select().from(connectorVersions).where(eq(connectorVersions.id, job.versionId!)).limit(1);
  const [connector] = await d.select().from(connectors).where(eq(connectors.id, job.connectorId)).limit(1);
  const detected: DetectedConfig = {
    apiTitle: connector?.name ?? "API",
    baseUrl: voted.baseUrlCandidates[0],
    baseUrlCandidates: voted.baseUrlCandidates,
    auth: voted.auth,
    warnings,
  };

  const usedModels = [...new Set(rows.map((r) => r.model).filter(Boolean))].join(", ");
  const versionId = version.id;
  const rowsToInsert = merged.map((a) => ({
    versionId,
    key: a.key,
    title: a.title,
    description: a.description,
    resource: a.resource,
    method: a.method,
    path: a.path,
    params: a.params,
    successCheck: a.successCheck,
    pagination: a.pagination,
    risk: a.risk,
    evidence: a.evidence,
    citation: a.citation,
    confidence: a.confidence,
    enabled: initialEnabled(a.risk, merged.length),
    requiresApproval: defaultRequiresApproval(a.risk),
  }));
  const inserts: BatchItem<"pg">[] = [];
  for (let i = 0; i < rowsToInsert.length; i += 100) inserts.push(d.insert(actions).values(rowsToInsert.slice(i, i + 100)));

  await d.batch([
    d.delete(actions).where(eq(actions.versionId, versionId)), // idempotent if a merge is retried
    ...inserts,
    d
      .update(connectorVersions)
      .set({
        detected,
        skipped: results.flatMap((r) => r.rejected),
        tokensIn: job.tokensIn,
        tokensOut: job.tokensOut,
        importCostUsd: job.costUsd ?? "0",
        llmModel: usedModels || version.llmModel,
      })
      .where(eq(connectorVersions.id, versionId)),
    d.update(importChunks).set({ segments: null }).where(eq(importChunks.jobId, job.id)),
    d
      .update(importJobs)
      .set({ stage: "done", status: "done", actionsFound: merged.length, finishedAt: new Date(), leaseUntil: null, warnings })
      .where(eq(importJobs.id, job.id)),
  ]);
}

/* Progress ---------------------------------------------------------------- */

export async function getImportProgress(jobId: string): Promise<ImportProgress | null> {
  const [job] = await db().select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  if (!job) return null;
  return {
    jobId: job.id,
    connectorId: job.connectorId,
    stage: job.stage,
    pagesRead: job.pagesRead,
    pagesPlanned: job.pagesRead + job.pendingUrls.length,
    chunksTotal: job.chunksTotal,
    chunksDone: job.chunksDone,
    actionsFound: job.actionsFound,
    costUsd: job.costUsd === null ? null : Number(job.costUsd),
    costKnown: job.costKnown,
    error: job.error,
    warnings: job.warnings,
    openApiLinks: job.openApiLinks,
  };
}
