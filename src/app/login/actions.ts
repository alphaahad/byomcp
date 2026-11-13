"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/server/env";
import { clientIp, loginBlocked, recordFailedLogin } from "@/server/auth/login-limit";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSessionValue,
  safeNextPath,
} from "@/server/auth/session";
import { recordSignIn, workspaceForPasscode } from "@/server/workspaces/workspaces";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const { CREDENTIALS_ENCRYPTION_KEY, APP_PASSCODE } = env();
  const attempt = String(formData.get("passcode") ?? "").slice(0, 200);
  const ip = clientIp(await headers());

  if (await loginBlocked(ip)) {
    return { error: "Too many wrong passcodes from this network. Wait 15 minutes, then try again." };
  }
  const workspace = await workspaceForPasscode(attempt, APP_PASSCODE);
  if (!workspace) {
    const wait = await recordFailedLogin(ip);
    await new Promise((r) => setTimeout(r, wait));
    return { error: "That passcode didn't work. Check it with whoever shared this link and try again." };
  }

  (await cookies()).set(SESSION_COOKIE, createSessionValue({ encryptionKey: CREDENTIALS_ENCRYPTION_KEY, passcode: APP_PASSCODE }, workspace.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  await recordSignIn(workspace.id);
  redirect(safeNextPath(formData.get("next")));
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
