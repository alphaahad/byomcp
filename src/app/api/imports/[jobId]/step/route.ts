import { z } from "zod";
import { currentWorkspace, ownsImportJob } from "@/server/auth/guard";
import { stepAiImport } from "@/server/import/run-ai-import";

// One step = a few page fetches or up to 3 parallel AI calls; well under this.
export const maxDuration = 60;

/** Advance an AI import by one step and return its progress. Called by the progress page. */
export async function POST(_req: Request, ctx: RouteContext<"/api/imports/[jobId]/step">) {
  if (!(await currentWorkspace())) {
    return Response.json({ error: "Sign in with the workspace passcode first." }, { status: 401 });
  }
  const { jobId } = await ctx.params;
  if (!z.uuid().safeParse(jobId).success || !(await ownsImportJob(jobId))) return Response.json({ error: "Import not found." }, { status: 404 });
  const progress = await stepAiImport(jobId);
  if (!progress) return Response.json({ error: "Import not found." }, { status: 404 });
  return Response.json(progress, { headers: { "cache-control": "no-store" } });
}
