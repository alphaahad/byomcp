import { z } from "zod";

/** An app's display name: trimmed, inner whitespace collapsed, 1–60 characters. */
export const AppNameSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Give the app a name.").max(60, "Keep the name under 60 characters."));
