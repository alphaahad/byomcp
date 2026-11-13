"use server";

import { z } from "zod";
import { approve, reject } from "@/server/approvals/approvals";
import { sendNotifyConfirmation, setNotifyEmail } from "@/server/notify/email";
import { ownsApproval, requireSession } from "@/server/auth/guard";

export type DecisionOutcome =
  | { ok: true; decision: "approved"; status: string; httpStatus: number | null; reason: string | null; preview: string }
  | { ok: true; decision: "rejected" }
  | { ok: false; error: string };

export async function approveAction(approvalId: string): Promise<DecisionOutcome> {
  await requireSession();
  if (!(await ownsApproval(approvalId))) return { ok: false, error: "That request wasn't found." };
  const r = await approve(approvalId);
  if (!r.ok) return r;
  const run = r.run!;
  return { ok: true, decision: "approved", status: run.status, httpStatus: run.httpStatus, reason: run.reason, preview: run.preview.slice(0, 1500) };
}

export async function rejectAction(approvalId: string): Promise<DecisionOutcome> {
  await requireSession();
  if (!(await ownsApproval(approvalId))) return { ok: false, error: "That request wasn't found." };
  const r = await reject(approvalId);
  return r.ok ? { ok: true, decision: "rejected" } : r;
}

export type NotifyState = { ok?: boolean; error?: string; email?: string | null; pending?: string };

/** "Email me when a request is waiting": one address per workspace, or off. */
export async function setNotifyEmailAction(_prev: NotifyState, formData: FormData): Promise<NotifyState> {
  const ws = await requireSession();
  if (formData.get("off") === "1") {
    await setNotifyEmail(ws.id, null);
    return { ok: true, email: null };
  }
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!z.email().safeParse(email).success || email.length > 254) return { error: "That doesn't look like an email address." };
  // Not saved yet: the address gets a link, and alerts start only once it's opened.
  const sent = await sendNotifyConfirmation(ws.id, email);
  return sent.ok ? { ok: true, pending: email } : { error: sent.error };
}
