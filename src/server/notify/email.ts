import "server-only";
/**
 * "A request is waiting for your approval" emails, via Resend's REST API
 * (POST https://api.resend.com/emails; checked 13 Nov 2026). No SDK: one
 * request through the SSRF-guarded fetch. Never blocks the MCP reply, never
 * includes the request payload or secrets, at most once per request, and at
 * most one email per workspace per 10 minutes.
 */
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { approvals, connectors, workspaces } from "@/server/db/schema";
import { env } from "@/server/env";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { safeFetch } from "@/server/net/safe-fetch";
import { appOrigin } from "@/server/origin";

export const NOTIFY_THROTTLE_MS = 10 * 60 * 1000;

/** Pure rule: email now unless this workspace was emailed in the last 10 minutes. */
export function shouldNotify(lastNotifiedAt: Date | null, now = Date.now()): boolean {
  return !lastNotifiedAt || now - lastNotifiedAt.getTime() >= NOTIFY_THROTTLE_MS;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function approvalEmail(input: { appName: string; summary: string; link: string; waitingCount: number }) {
  const subject = `Approval needed: ${input.appName}`.slice(0, 120);
  const more = input.waitingCount > 1 ? `<p>${input.waitingCount - 1} more request${input.waitingCount > 2 ? "s are" : " is"} waiting too.</p>` : "";
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1f1f29">
<p>Your AI employee wants to do this in <strong>${escapeHtml(input.appName)}</strong>:</p>
<p style="padding:12px 14px;background:#f3eeff;border-radius:8px">${escapeHtml(input.summary)}</p>
<p>Nothing has been sent to ${escapeHtml(input.appName)} yet. It runs once, only if you approve it, and the request expires after 24 hours.</p>
${more}
<p><a href="${escapeHtml(input.link)}" style="display:inline-block;padding:10px 16px;background:#6d28d9;color:#fff;border-radius:8px;text-decoration:none">Review in BYOMCP</a></p>
<p style="color:#6b6b7b;font-size:13px">You get this because notifications are on for your BYOMCP workspace. Turn them off on the Approvals page.</p>
</div>`;
  const text = `Your AI employee wants to do this in ${input.appName}:\n\n${input.summary}\n\nNothing has been sent yet. It runs once, only if you approve it.\nReview: ${input.link}`;
  return { subject, html, text };
}

/** Send the email for a new approval, if this workspace wants them. Safe to call fire-and-forget. */
export async function notifyApprovalWaiting(approvalId: string): Promise<"sent" | "skipped" | "failed"> {
  const e = env();
  if (!e.RESEND_API_KEY) return "skipped";
  const d = db();
  const [row] = await d
    .select({ summary: approvals.summary, appName: connectors.name, workspaceId: workspaces.id, to: workspaces.notifyEmail })
    .from(approvals)
    .innerJoin(connectors, eq(approvals.connectorId, connectors.id))
    .innerJoin(workspaces, eq(connectors.workspaceId, workspaces.id))
    .where(eq(approvals.id, approvalId))
    .limit(1);
  if (!row?.to) return "skipped";

  const [last] = await d
    .select({ at: sql<Date | null>`max(${approvals.notifiedAt})` })
    .from(approvals)
    .innerJoin(connectors, eq(approvals.connectorId, connectors.id))
    .where(and(eq(connectors.workspaceId, row.workspaceId), isNotNull(approvals.notifiedAt)));
  if (!shouldNotify(last?.at ? new Date(last.at) : null)) return "skipped";

  // Claim it first, so two concurrent calls never send twice.
  const [claimed] = await d
    .update(approvals)
    .set({ notifiedAt: new Date() })
    .where(and(eq(approvals.id, approvalId), isNull(approvals.notifiedAt)))
    .returning({ id: approvals.id });
  if (!claimed) return "skipped";

  const [{ n }] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(approvals)
    .innerJoin(connectors, eq(approvals.connectorId, connectors.id))
    .where(and(eq(connectors.workspaceId, row.workspaceId), eq(approvals.status, "pending"), gt(approvals.createdAt, new Date(Date.now() - 24 * 3600 * 1000))));

  const mail = approvalEmail({ appName: row.appName, summary: row.summary, link: `${appOrigin()}/approvals`, waitingCount: n });
  try {
    const res = await safeFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${e.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": `approval-${approvalId}` },
      body: JSON.stringify({ from: e.NOTIFY_FROM, to: [row.to], subject: mail.subject, html: mail.html, text: mail.text }),
      maxBytes: 64 * 1024,
      timeoutMs: 8000,
      maxRedirects: 0,
    });
    if (res.status >= 300) {
      // Logged without the address or key. 403 usually means: no verified domain, so Resend only delivers to the account's own email.
      console.error(`Approval email not sent: Resend HTTP ${res.status}: ${res.text().slice(0, 200)}`);
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error(`Approval email not sent: ${err instanceof Error ? err.message : "network error"}`);
    return "failed";
  }
}

export async function setNotifyEmail(workspaceId: string, email: string | null) {
  await db().update(workspaces).set({ notifyEmail: email }).where(eq(workspaces.id, workspaceId));
}

export async function getNotifyEmail(workspaceId: string): Promise<string | null> {
  const [w] = await db().select({ to: workspaces.notifyEmail }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return w?.to ?? null;
}

/* Confirming an address ------------------------------------------------ */

/** One email through Resend's REST API. */
async function sendEmail(to: string, mail: { subject: string; html: string; text: string }, idempotencyKey: string): Promise<boolean> {
  const e = env();
  if (!e.RESEND_API_KEY) return false;
  try {
    const res = await safeFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${e.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ from: e.NOTIFY_FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text }),
      maxBytes: 64 * 1024,
      timeoutMs: 8000,
      maxRedirects: 0,
    });
    if (res.status >= 300) console.error(`Email not sent: Resend HTTP ${res.status}: ${res.text().slice(0, 200)}`);
    return res.status < 300;
  } catch (err) {
    console.error(`Email not sent: ${err instanceof Error ? err.message : "network error"}`);
    return false;
  }
}

const CONFIRM_TTL_MS = 24 * 3600 * 1000;
const CONFIRM_THROTTLE_MS = 2 * 60 * 1000;

function confirmKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(env().CREDENTIALS_ENCRYPTION_KEY, "base64"), Buffer.alloc(0), "byomcp-notify-confirm-v1", 32));
}

/** A signed, expiring link token naming the workspace and the address. */
export function signConfirmToken(workspaceId: string, email: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ w: workspaceId, e: email, x: now + CONFIRM_TTL_MS })).toString("base64url");
  return `${payload}.${createHmac("sha256", confirmKey()).update(payload).digest("base64url")}`;
}

export function verifyConfirmToken(token: string, now = Date.now()): { workspaceId: string; email: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", confirmKey()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { w: string; e: string; x: number };
    return typeof p.w === "string" && typeof p.e === "string" && p.x > now ? { workspaceId: p.w, email: p.e } : null;
  } catch {
    return null;
  }
}

/**
 * Send "confirm this address" with a signed link. The address only receives
 * approval alerts once someone signed in to this workspace opens the link,
 * so nobody can point our alerts at an inbox they don't control.
 */
export async function sendNotifyConfirmation(workspaceId: string, email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env().RESEND_API_KEY) return { ok: false, error: "Email alerts aren't set up on this BYOMCP yet." };
  const d = db();
  // Claim the send slot atomically (at most one confirmation every 2 minutes per workspace).
  const [claimed] = await d
    .update(workspaces)
    .set({ notifyConfirmSentAt: new Date() })
    .where(
      and(
        eq(workspaces.id, workspaceId),
        sql`(${workspaces.notifyConfirmSentAt} is null or ${workspaces.notifyConfirmSentAt} < ${new Date(Date.now() - CONFIRM_THROTTLE_MS)})`,
      ),
    )
    .returning({ id: workspaces.id });
  if (!claimed) return { ok: false, error: "We just sent a confirmation email. Check your inbox (and spam), or try again in 2 minutes." };

  const link = `${appOrigin()}/approvals/confirm?t=${encodeURIComponent(signConfirmToken(workspaceId, email))}`;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1f1f29">
<p>Someone asked BYOMCP to email this address when an AI employee's request is waiting for approval.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;background:#6d28d9;color:#fff;border-radius:8px;text-decoration:none">Turn on approval alerts</a></p>
<p style="color:#6b6b7b;font-size:13px">The link works for 24 hours, only while signed in to that BYOMCP workspace. If this wasn't you, ignore this email: nothing changes.</p>
</div>`;
  const text = `Someone asked BYOMCP to email this address when an AI employee's request is waiting for approval.\n\nTurn on approval alerts: ${link}\n\nThe link works for 24 hours. If this wasn't you, ignore this email.`;
  const sent = await sendEmail(email, { subject: "Confirm your BYOMCP approval alerts", html, text }, `confirm-${workspaceId}-${Date.now()}`);
  return sent ? { ok: true } : { ok: false, error: "We couldn't send the confirmation email. Check the address, or try again later." };
}
