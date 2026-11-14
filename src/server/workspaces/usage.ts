import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";

/**
 * The owner's Usage page: what every workspace did, across all of them.
 * Read-only, and deliberately metadata only: it never selects call inputs,
 * results, approval payloads, credentials or tokens.
 */

/** Days are grouped in the owner's time zone. */
export const USAGE_TZ = "Asia/Kolkata";
export const USAGE_DAYS = 30;

const n = (v: unknown) => Number(v ?? 0);
const rows = async <T,>(q: ReturnType<typeof sql>) => ((await db().execute(q)) as unknown as { rows: T[] }).rows;

/** A call that failed because of the app or the connection (not the model's bad input, a person, or a wait). */
const FAILED = sql`t.status in ('empty_or_invalid','auth_failed','transient_failed','request_error')`;

export type UsageTotals = {
  workspaces: number;
  active7d: number;
  active30d: number;
  apps: number;
  published: number;
  calls: number;
  calls7d: number;
  failedCalls: number;
  mcpCalls: number;
  aiImports: number;
  aiTokens: number;
  chats: number;
  chatTokens: number;
  aiCostUsd: number;
  approvals: { pending: number; approved: number; rejected: number; expired: number };
  signIns30d: number;
};

export async function usageTotals(): Promise<UsageTotals> {
  const [r] = await rows<Record<string, unknown>>(sql`
    with activity as (
      select workspace_id, created_at from sign_ins
      union all select c.workspace_id, t.created_at from tool_calls t join connectors c on c.id = t.connector_id
      union all select c.workspace_id, v.created_at from connector_versions v join connectors c on c.id = v.connector_id
      union all select workspace_id, created_at from chat_usage
    )
    select
      (select count(*) from workspaces) as workspaces,
      (select count(distinct workspace_id) from activity where created_at >= now() - interval '7 days') as active7d,
      (select count(distinct workspace_id) from activity where created_at >= now() - interval '30 days') as active30d,
      (select count(*) from connectors) as apps,
      (select count(*) from connectors where status = 'published') as published,
      (select count(*) from tool_calls) as calls,
      (select count(*) from tool_calls where created_at >= now() - interval '7 days') as calls7d,
      (select count(*) from tool_calls t where ${FAILED}) as failed_calls,
      (select count(*) from tool_calls where source = 'mcp') as mcp_calls,
      (select count(*) from connector_versions where source_type in ('docs_url','text') and version = 1) as ai_imports,
      (select coalesce(sum(tokens_in + tokens_out), 0) from connector_versions) as ai_tokens,
      (select count(*) from chat_usage) as chats,
      (select coalesce(sum(tokens_in + tokens_out), 0) from chat_usage) as chat_tokens,
      (select coalesce(sum(import_cost_usd), 0) from connector_versions) + (select coalesce(sum(cost_usd), 0) from chat_usage) as ai_cost,
      (select count(*) from approvals where status = 'pending') as ap_pending,
      (select count(*) from approvals where status = 'approved') as ap_approved,
      (select count(*) from approvals where status = 'rejected') as ap_rejected,
      (select count(*) from approvals where status = 'expired') as ap_expired,
      (select count(*) from sign_ins where created_at >= now() - interval '30 days') as sign_ins_30d
  `);
  return {
    workspaces: n(r.workspaces),
    active7d: n(r.active7d),
    active30d: n(r.active30d),
    apps: n(r.apps),
    published: n(r.published),
    calls: n(r.calls),
    calls7d: n(r.calls7d),
    failedCalls: n(r.failed_calls),
    mcpCalls: n(r.mcp_calls),
    aiImports: n(r.ai_imports),
    aiTokens: n(r.ai_tokens),
    chats: n(r.chats),
    chatTokens: n(r.chat_tokens),
    aiCostUsd: n(r.ai_cost),
    approvals: { pending: n(r.ap_pending), approved: n(r.ap_approved), rejected: n(r.ap_rejected), expired: n(r.ap_expired) },
    signIns30d: n(r.sign_ins_30d),
  };
}

export type UsageDay = { day: string; calls: number; aiImports: number; chats: number; signIns: number };

/** One row per day for the last USAGE_DAYS days (oldest first), including empty days. */
export async function usageByDay(workspaceId?: string): Promise<UsageDay[]> {
  const ws = (col: ReturnType<typeof sql>) => (workspaceId ? sql`and ${col} = ${workspaceId}` : sql``);
  const day = (col: ReturnType<typeof sql>) => sql`to_char(${col} at time zone ${USAGE_TZ}, 'YYYY-MM-DD')`;
  const since = sql`now() - interval '${sql.raw(String(USAGE_DAYS))} days'`;
  const r = await rows<{ day: string; calls: unknown; ai_imports: unknown; chats: unknown; sign_ins: unknown }>(sql`
    with days as (
      select to_char(d, 'YYYY-MM-DD') as day
      from generate_series(
        ((now() at time zone ${USAGE_TZ})::date - ${sql.raw(String(USAGE_DAYS - 1))})::timestamp,
        ((now() at time zone ${USAGE_TZ})::date)::timestamp,
        interval '1 day'
      ) d
    ),
    c as (select ${day(sql`t.created_at`)} as day, count(*) as k from tool_calls t join connectors x on x.id = t.connector_id
          where t.created_at >= ${since} ${ws(sql`x.workspace_id`)} group by 1),
    i as (select ${day(sql`v.created_at`)} as day, count(*) as k from connector_versions v join connectors x on x.id = v.connector_id
          where v.source_type in ('docs_url','text') and v.version = 1 and v.created_at >= ${since} ${ws(sql`x.workspace_id`)} group by 1),
    m as (select ${day(sql`u.created_at`)} as day, count(*) as k from chat_usage u
          where u.created_at >= ${since} ${ws(sql`u.workspace_id`)} group by 1),
    s as (select ${day(sql`g.created_at`)} as day, count(*) as k from sign_ins g
          where g.created_at >= ${since} ${ws(sql`g.workspace_id`)} group by 1)
    select days.day, coalesce(c.k, 0) as calls, coalesce(i.k, 0) as ai_imports, coalesce(m.k, 0) as chats, coalesce(s.k, 0) as sign_ins
    from days left join c using (day) left join i using (day) left join m using (day) left join s using (day)
    order by days.day
  `);
  return r.map((x) => ({ day: x.day, calls: n(x.calls), aiImports: n(x.ai_imports), chats: n(x.chats), signIns: n(x.sign_ins) }));
}

export type WorkspaceUsage = {
  id: string;
  label: string;
  isOwner: boolean;
  revoked: boolean;
  createdAt: Date;
  lastActiveAt: Date | null;
  signIns: number;
  apps: number;
  published: number;
  calls: number;
  calls7d: number;
  failedCalls: number;
  pendingApprovals: number;
  aiImports: number;
  chats: number;
  aiCostUsd: number;
};

/** Every workspace with its all-time usage, most recently active first. */
export async function usageByWorkspace(): Promise<WorkspaceUsage[]> {
  const r = await rows<Record<string, unknown>>(sql`
    select w.id, w.label, w.is_owner, w.revoked_at, w.created_at,
      greatest(
        w.last_sign_in_at,
        (select max(t.created_at) from tool_calls t join connectors c on c.id = t.connector_id where c.workspace_id = w.id),
        (select max(v.created_at) from connector_versions v join connectors c on c.id = v.connector_id where c.workspace_id = w.id),
        (select max(u.created_at) from chat_usage u where u.workspace_id = w.id)
      ) as last_active,
      (select count(*) from sign_ins g where g.workspace_id = w.id) as sign_ins,
      (select count(*) from connectors c where c.workspace_id = w.id) as apps,
      (select count(*) from connectors c where c.workspace_id = w.id and c.status = 'published') as published,
      (select count(*) from tool_calls t join connectors c on c.id = t.connector_id where c.workspace_id = w.id) as calls,
      (select count(*) from tool_calls t join connectors c on c.id = t.connector_id where c.workspace_id = w.id and t.created_at >= now() - interval '7 days') as calls7d,
      (select count(*) from tool_calls t join connectors c on c.id = t.connector_id where c.workspace_id = w.id and ${FAILED}) as failed_calls,
      (select count(*) from approvals a join connectors c on c.id = a.connector_id where c.workspace_id = w.id and a.status = 'pending') as pending_approvals,
      (select count(*) from connector_versions v join connectors c on c.id = v.connector_id where c.workspace_id = w.id and v.source_type in ('docs_url','text') and v.version = 1) as ai_imports,
      (select count(*) from chat_usage u where u.workspace_id = w.id) as chats,
      (select coalesce(sum(v.import_cost_usd), 0) from connector_versions v join connectors c on c.id = v.connector_id where c.workspace_id = w.id)
        + (select coalesce(sum(u.cost_usd), 0) from chat_usage u where u.workspace_id = w.id) as ai_cost
    from workspaces w
    order by last_active desc nulls last, w.created_at
  `);
  return r.map((x) => ({
    id: String(x.id),
    label: String(x.label),
    isOwner: x.is_owner === true,
    revoked: x.revoked_at != null,
    createdAt: new Date(String(x.created_at)),
    lastActiveAt: x.last_active ? new Date(String(x.last_active)) : null,
    signIns: n(x.sign_ins),
    apps: n(x.apps),
    published: n(x.published),
    calls: n(x.calls),
    calls7d: n(x.calls7d),
    failedCalls: n(x.failed_calls),
    pendingApprovals: n(x.pending_approvals),
    aiImports: n(x.ai_imports),
    chats: n(x.chats),
    aiCostUsd: n(x.ai_cost),
  }));
}

export type WorkspaceDetail = {
  apps: {
    id: string;
    name: string;
    status: string;
    sourceType: string | null;
    createdAt: Date;
    actions: number;
    enabled: number;
    calls: number;
    failedCalls: number;
    lastCallAt: Date | null;
  }[];
  calls: { at: Date; app: string; action: string; source: string; status: string; httpStatus: number | null; durationMs: number | null }[];
  imports: { at: Date; app: string; sourceType: string; model: string | null; tokens: number; costUsd: number; actions: number }[];
  chats: { at: Date; app: string | null; model: string | null; tokens: number; toolCalls: number; costUsd: number }[];
  signIns: Date[];
  requests: { at: Date; appName: string }[];
};

/** One workspace in detail (metadata only: no inputs, results or payloads). */
export async function workspaceUsageDetail(workspaceId: string): Promise<WorkspaceDetail> {
  const [apps, calls, imports, chats, signIns, requests] = await Promise.all([
    rows<Record<string, unknown>>(sql`
      select c.id, c.name, c.status, c.created_at,
        (select v.source_type from connector_versions v where v.connector_id = c.id order by v.version limit 1) as source_type,
        (select count(*) from actions a join connector_versions v on v.id = a.version_id where v.connector_id = c.id and v.version = (select max(version) from connector_versions where connector_id = c.id)) as actions,
        (select count(*) from actions a join connector_versions v on v.id = a.version_id where v.connector_id = c.id and a.enabled and v.version = (select max(version) from connector_versions where connector_id = c.id)) as enabled,
        (select count(*) from tool_calls t where t.connector_id = c.id) as calls,
        (select count(*) from tool_calls t where t.connector_id = c.id and ${FAILED}) as failed_calls,
        (select max(t.created_at) from tool_calls t where t.connector_id = c.id) as last_call
      from connectors c where c.workspace_id = ${workspaceId} order by c.created_at`),
    rows<Record<string, unknown>>(sql`
      select t.created_at, c.name as app, t.action_key, t.source, t.status, t.http_status, t.duration_ms
      from tool_calls t join connectors c on c.id = t.connector_id
      where c.workspace_id = ${workspaceId} order by t.created_at desc limit 50`),
    rows<Record<string, unknown>>(sql`
      select v.created_at, c.name as app, v.source_type, v.llm_model, v.tokens_in + v.tokens_out as tokens, v.import_cost_usd,
        (select count(*) from actions a where a.version_id = v.id) as actions
      from connector_versions v join connectors c on c.id = v.connector_id
      where c.workspace_id = ${workspaceId} and v.version = 1 order by v.created_at desc limit 50`),
    rows<Record<string, unknown>>(sql`
      select u.created_at, c.name as app, u.model, u.tokens_in + u.tokens_out as tokens, u.tool_calls, u.cost_usd
      from chat_usage u left join connectors c on c.id = u.connector_id
      where u.workspace_id = ${workspaceId} order by u.created_at desc limit 50`),
    rows<{ created_at: unknown }>(sql`select created_at from sign_ins where workspace_id = ${workspaceId} order by created_at desc limit 20`),
    rows<Record<string, unknown>>(sql`select created_at, app_name from app_requests where workspace_id = ${workspaceId} order by created_at desc limit 20`),
  ]);
  const date = (v: unknown) => new Date(String(v));
  return {
    apps: apps.map((a) => ({
      id: String(a.id),
      name: String(a.name),
      status: String(a.status),
      sourceType: a.source_type ? String(a.source_type) : null,
      createdAt: date(a.created_at),
      actions: n(a.actions),
      enabled: n(a.enabled),
      calls: n(a.calls),
      failedCalls: n(a.failed_calls),
      lastCallAt: a.last_call ? date(a.last_call) : null,
    })),
    calls: calls.map((c) => ({
      at: date(c.created_at),
      app: String(c.app),
      action: String(c.action_key),
      source: String(c.source),
      status: String(c.status),
      httpStatus: c.http_status == null ? null : n(c.http_status),
      durationMs: c.duration_ms == null ? null : n(c.duration_ms),
    })),
    imports: imports.map((i) => ({
      at: date(i.created_at),
      app: String(i.app),
      sourceType: String(i.source_type),
      model: i.llm_model ? String(i.llm_model) : null,
      tokens: n(i.tokens),
      costUsd: n(i.import_cost_usd),
      actions: n(i.actions),
    })),
    chats: chats.map((c) => ({
      at: date(c.created_at),
      app: c.app ? String(c.app) : null,
      model: c.model ? String(c.model) : null,
      tokens: n(c.tokens),
      toolCalls: n(c.tool_calls),
      costUsd: n(c.cost_usd),
    })),
    signIns: signIns.map((s) => date(s.created_at)),
    requests: requests.map((r) => ({ at: date(r.created_at), appName: String(r.app_name) })),
  };
}
