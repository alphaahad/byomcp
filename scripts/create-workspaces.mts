/**
 * Create guest workspaces, each with its own passcode.
 *
 *   node scripts/create-workspaces.mts 4            -> "Guest 1" … "Guest 4"
 *   node scripts/create-workspaces.mts "Reviewer" "Sam" -> named workspaces
 *
 * Passcodes are stored only as SHA-256 hashes. The plain codes are appended to
 * WORKSPACE-PASSCODES.md in the project folder, which is gitignored: share them
 * from there, and never commit that file.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { generatePasscode, hashPasscode } from "../src/server/auth/session.ts";

const FILE = "WORKSPACE-PASSCODES.md";

if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL in .env.local first.");
  process.exit(1);
}
if (!readFileSync(".gitignore", "utf8").split(/\r?\n/).includes(FILE)) {
  console.error(`${FILE} isn't in .gitignore. Add it before creating passcodes.`);
  process.exit(1);
}

const args = process.argv.slice(2);
const sql = neon(process.env.DATABASE_URL);
const [{ n: existingGuests }] = (await sql`select count(*)::int as n from workspaces where not is_owner`) as { n: number }[];
const labels =
  args.length === 1 && /^\d+$/.test(args[0])
    ? Array.from({ length: Number(args[0]) }, (_, i) => `Guest ${existingGuests + i + 1}`)
    : args.map((a) => a.replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean);
if (labels.length === 0 || labels.length > 50) {
  console.error("Pass a count (1-50) or one or more workspace names.");
  process.exit(1);
}

const created: { label: string; code: string }[] = [];
for (const label of labels) {
  const code = generatePasscode();
  await sql`insert into workspaces (label, passcode_hash) values (${label}, ${hashPasscode(code)})`;
  created.push({ label, code });
}

if (!existsSync(FILE)) {
  appendFileSync(
    FILE,
    `# BYOMCP workspace passcodes

Local only: this file is gitignored. Each passcode opens its own workspace at https://byomcp.vercel.app (separate apps, approvals and activity).
Passcodes are stored only as hashes, so they can't be recovered from the app. Keep this file; to cut someone off, revoke their workspace on the Workspaces page.

| Workspace | Passcode | Created |
|---|---|---|
| Your workspace (owner) | your existing \`APP_PASSCODE\` (unchanged, not written here) | |
`,
  );
}
const today = new Date().toISOString().slice(0, 10);
appendFileSync(FILE, created.map((c) => `| ${c.label} | \`${c.code}\` | ${today} |\n`).join(""));
console.log(`Created ${created.length} workspace(s): ${created.map((c) => c.label).join(", ")}. Passcodes written to ${FILE}.`);
