/** Base URL templates like "https://{companyDomain}.bamboohr.com" (shared by UI and server). */

export function templateVars(template: string): string[] {
  return [...new Set([...template.matchAll(/\{([A-Za-z_][\w-]*)\}/g)].map((m) => m[1]))];
}

/** Fill {vars}. Values may only be hostname/path-safe text, so a value can't change the URL's shape. */
export function fillTemplate(template: string, values: Record<string, string>): { url?: string; error?: string } {
  for (const name of templateVars(template)) {
    const v = (values[name] ?? "").trim();
    if (!v) return { error: `Fill in "${name}".` };
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(v)) {
      return { error: `"${name}" can only contain letters, numbers, dots, dashes and underscores.` };
    }
  }
  return { url: template.replace(/\{([A-Za-z_][\w-]*)\}/g, (_, n: string) => values[n].trim()) };
}
