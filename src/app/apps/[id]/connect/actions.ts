"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { fillTemplate, templateVars } from "@/lib/base-url";
import { ownedConnector, requireSession } from "@/server/auth/guard";
import { runConnectionCheck } from "@/server/connectors/auto-check";
import { AuthTypeSchema, saveConnection } from "@/server/connectors/connection";
import type { Secret } from "@/server/crypto/credentials";
import { SafeFetchError, assertPublicBaseUrl } from "@/server/net/safe-fetch";

export type ConnectState = { error?: string; field?: string };

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;

export async function saveConnectionAction(_prev: ConnectState, formData: FormData): Promise<ConnectState> {
  await requireSession();
  const get = (k: string) => String(formData.get(k) ?? "");
  const connectorId = get("connectorId");
  if (!z.uuid().safeParse(connectorId).success || !(await ownedConnector(connectorId))) return { error: "This app wasn't found." };

  // Server address: template + filled placeholders.
  const template = get("baseUrlTemplate").trim();
  const vars = Object.fromEntries(templateVars(template).map((n) => [n, get(`var_${n}`)]));
  const filled = fillTemplate(template, vars);
  if (filled.error) return { error: filled.error, field: "baseUrl" };
  let baseUrl: string;
  try {
    baseUrl = await assertPublicBaseUrl(filled.url!);
  } catch (err) {
    return { error: err instanceof SafeFetchError ? err.message : "That server address isn't valid.", field: "baseUrl" };
  }

  const authType = AuthTypeSchema.safeParse(get("authType"));
  if (!authType.success) return { error: "Choose how the app signs in.", field: "authType" };

  let apiKey: { in: "header" | "query" | "path"; name: string } | undefined;
  let secret: Secret | undefined;
  switch (authType.data) {
    case "api_key": {
      const placed = get("apiKeyIn");
      const where = placed === "query" || placed === "path" ? placed : "header";
      const name = get("apiKeyName").trim();
      if (!HEADER_NAME.test(name)) return { error: "Enter the name the app expects for the key, e.g. X-Api-Key.", field: "apiKeyName" };
      apiKey = { in: where, name };
      const value = get("apiKeyValue").trim();
      if (value) secret = { kind: "api_key", value };
      break;
    }
    case "bearer": {
      const token = get("bearerToken").trim();
      if (token) secret = { kind: "bearer", token };
      break;
    }
    case "basic": {
      const username = get("basicUsername").trim();
      const password = get("basicPassword");
      if (username) secret = { kind: "basic", username, password };
      else if (password) return { error: "Enter the username too.", field: "basicUsername" };
      break;
    }
  }
  if (secret && /[\r\n]/.test(JSON.stringify(secret))) return { error: "Keys can't contain line breaks." };

  const saved = await saveConnection({ connectorId, baseUrl, authType: authType.data, apiKey, secret });
  if (!saved.ok) return { error: saved.error, field: "secret" };

  // Check it straight away with a safe read, so the user sees "Connected and working ✓" (or what to fix).
  const check = await runConnectionCheck(connectorId);
  if (!check.ran) redirect(`/apps/${connectorId}/review?connected=1`);
  const found = check.found ? `&found=${encodeURIComponent(check.found.slice(0, 40))}` : "";
  redirect(`/apps/${connectorId}/connect?checked=1${found}`);
}
