/**
 * Records the narrated walkthrough video (and README screenshots) by driving
 * the live site in Microsoft Edge with Playwright. No browser download.
 *
 *   BASE_URL=https://byomcp.vercel.app DEMO_PASSCODE=byo-… FFMPEG=path/to/ffmpeg node scripts/record-walkthrough.mts
 *
 * 1. Narration: each caption is spoken by Gemini text-to-speech (GEMINI_API_KEY
 *    from .env.local; TTS_MODEL / TTS_VOICE to override). Clips are cached in
 *    .walkthrough/ (gitignored), so re-runs only pay for changed lines. Only the
 *    caption text below is sent: no app data, keys or passcodes.
 * 2. Recording: each caption stays up until its narration has finished, and the
 *    moment it appears is noted, so voice and picture line up.
 * 3. Mixing: a full ffmpeg (FFMPEG, with libx264 + aac; Playwright's own copy has
 *    no audio encoder) lays each clip at its moment and writes the MP4.
 *
 * Use a throwaway guest workspace (scripts/create-workspaces.mts) and delete it
 * afterwards: the run creates apps, an approval and a chat in that workspace.
 * Output: docs/media/walkthrough.mp4 and docs/media/*.png
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const BASE = (process.env.BASE_URL ?? "https://byomcp.vercel.app").replace(/\/$/, "");
const PASSCODE = process.env.DEMO_PASSCODE;
const FFMPEG = process.env.FFMPEG;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TTS_MODEL = process.env.TTS_MODEL ?? "gemini-3.8-flash-tts";
const TTS_VOICE = process.env.TTS_VOICE ?? "Sulafat";
const TTS_STYLE = "Warm, clear, confident product walkthrough. Relaxed, natural pace.";
for (const [name, value] of Object.entries({ DEMO_PASSCODE: PASSCODE, FFMPEG, GEMINI_API_KEY })) {
  if (!value) {
    console.error(`Set ${name} first (see the comment at the top of this script).`);
    process.exit(1);
  }
}

const OUT = "docs/media";
const WORK = ".walkthrough";
const RAW = join(WORK, "raw");
const CLIPS = join(WORK, "clips");
rmSync(RAW, { recursive: true, force: true });
mkdirSync(RAW, { recursive: true });
mkdirSync(CLIPS, { recursive: true });

/** What's on screen, and (when different) how it should be said out loud. */
const LINES = {
  intro: {
    caption: "BYOMCP gives AI employees any app: pick it, choose what it may do, and get a safe MCP server.",
    say: "Bring Your Own M C P gives AI employees any app. Pick the app, choose what it may do, and get a safe M C P server.",
  },
  home: { caption: "A new workspace opens with what you'll need, and where AI is used (and where it isn't)." },
  catalog: { caption: "Start from the app's name. Every listed app was checked with a real import." },
  zendesk: {
    caption: "Zendesk's OpenAPI file: 675 actions, read with no AI. Big APIs start with nothing turned on.",
    say: "Here's Zendesk. Its Open A P I file has six hundred and seventy-five actions, read with no AI. Big APIs start with nothing turned on.",
  },
  jobs: { caption: "Choose jobs, not endpoints. Writes still wait for a person to approve." },
  jobsOn: { caption: "Exactly the actions that job needs are on." },
  connect: { caption: "Connecting is guided: where to find the key, what each field means, a message for your admin." },
  sample: { caption: "To show the whole loop without an account, use the sample app." },
  sampleReady: { caption: "It connected itself and ran a safe read: the Setup panel always shows the next step." },
  sampleJobs: { caption: "Reads run on their own. Adding a pet changes data, so it will wait for approval." },
  publish: {
    caption: "Publish gives an MCP address and a token, shown once. Copy setup copies both.",
    say: "Publish gives an M C P address and a token, shown once. Copy setup copies both.",
  },
  handoff: { caption: "Three steps to add it in UnleashX, and a ready message for whoever manages it.", say: "Three steps to add it in Unleash X, and a ready message for whoever manages it." },
  talk: { caption: "Talk to it: ask in plain words and watch an AI employee use the published tools." },
  consent: { caption: "First, an honest notice about what this test sends to the AI." },
  answered: { caption: "It picked the right tool, called the real MCP address, and answered from the data.", say: "It picked the right tool, called the real M C P address, and answered from the data." },
  write: { caption: "A write never just runs: it waits for a person, exactly as for a real AI employee." },
  approvals: { caption: "The request in plain words, with the exact payload. Approve runs it exactly once." },
  done: { caption: "Done: it ran once, and the result is readable." },
  activity: { caption: "Every call is logged, secrets hidden. Health says when a key stops working." },
  outro: { caption: "AI reads docs once. Running the connector costs nothing extra, and you stay in control." },
} satisfies Record<string, { caption: string; say?: string }>;
type LineId = keyof typeof LINES;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seconds of audio in a 16-bit PCM WAV, read from its header. */
function wavSeconds(file: string) {
  const buf = readFileSync(file);
  const byteRate = buf.readUInt32LE(28);
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "data") return Math.min(size, buf.length - offset - 8) / byteRate;
    offset += 8 + size + (size % 2);
  }
  throw new Error(`No audio data in ${file}`);
}

/** One cached WAV per line, keyed by its words, voice and model. */
async function narrate(): Promise<Record<LineId, { file: string; seconds: number }>> {
  const clips = {} as Record<LineId, { file: string; seconds: number }>;
  for (const [id, line] of Object.entries(LINES) as [LineId, { caption: string; say?: string }][]) {
    const text = line.say ?? line.caption;
    const key = createHash("sha256").update(`${TTS_MODEL}|${TTS_VOICE}|${TTS_STYLE}|${text}`).digest("hex").slice(0, 16);
    const file = join(CLIPS, `${id}-${key}.wav`);
    for (let attempt = 1; !existsSync(file); attempt++) {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_API_KEY! },
        body: JSON.stringify({
          model: TTS_MODEL,
          input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style: TTS_STYLE }] }] }],
          response_format: { type: "audio", mime_type: "audio/wav" },
          generation_config: { speech_config: [{ voice: TTS_VOICE }] },
        }),
      });
      if (res.status === 429 && attempt < 8) {
        console.log(`Narration rate-limited; waiting a minute (${id})`);
        await pause(62_000);
        continue;
      }
      if (!res.ok) throw new Error(`Text-to-speech failed for "${id}": ${res.status} ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as { steps?: { type: string; content?: { type: string; data?: string }[] }[] };
      const audio = json.steps?.flatMap((s) => s.content ?? []).find((c) => c.type === "audio" && c.data);
      if (!audio?.data) throw new Error(`Text-to-speech returned no audio for "${id}".`);
      writeFileSync(file, Buffer.from(audio.data, "base64"));
      console.log(`Narrated ${id}`);
    }
    clips[id] = { file, seconds: wavSeconds(file) };
  }
  return clips;
}

async function main() {
  const clips = await narrate();
  const cues: { id: LineId; at: number }[] = [];
  let t0 = 0;

  /** Shows a caption bar, notes when it appeared, and holds until its narration ends. */
  async function caption(page: Page, id: LineId, minHoldMs = 1200) {
    await page.evaluate((t) => {
      let el = document.getElementById("__walkthrough_caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "__walkthrough_caption";
        el.setAttribute("aria-hidden", "true");
        Object.assign(el.style, {
          position: "fixed",
          left: "50%",
          bottom: "24px",
          transform: "translateX(-50%)",
          maxWidth: "980px",
          padding: "12px 20px",
          borderRadius: "12px",
          background: "rgba(17,17,24,0.92)",
          color: "#fff",
          font: "500 18px/1.4 Outfit, system-ui, sans-serif",
          boxShadow: "0 8px 30px rgba(0,0,0,.25)",
          zIndex: "2147483647",
          textAlign: "center",
          pointerEvents: "none",
        });
        document.body.appendChild(el);
      }
      el.textContent = t;
    }, LINES[id].caption);
    cues.push({ id, at: Date.now() - t0 });
    await pause(Math.max(minHoldMs, clips[id].seconds * 1000 + 450));
  }

  const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `${name}.png`) });
  async function goto(page: Page, path: string) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await pause(600);
  }

  const SIZE = { width: 1280, height: 800 };
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: SIZE, colorScheme: "light", recordVideo: { dir: RAW, size: SIZE } });
  const page = await context.newPage();
  t0 = Date.now(); // the video starts with the page
  page.setDefaultTimeout(60_000);

  // 1. Sign in
  await goto(page, "/login");
  await caption(page, "intro");
  await page.fill('input[name="passcode"]', PASSCODE!);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE}/`);
  await pause(1200);

  // 2. Home: welcome + catalog
  await caption(page, "home");
  await shot(page, "01-home");
  await page.locator("#pick-app").scrollIntoViewIfNeeded();
  await caption(page, "catalog");

  // 3. Zendesk: jobs + guided connection (no real account needed to show it)
  await page.getByRole("button", { name: /Zendesk/ }).first().click();
  await page.waitForURL(/\/review\?new=1/, { timeout: 90_000 });
  await pause(1500);
  await caption(page, "zendesk");
  await page.locator("#jobs-title").scrollIntoViewIfNeeded();
  await caption(page, "jobs");
  await page.getByRole("checkbox", { name: /Answer customer tickets/ }).check();
  await page.getByRole("button", { name: "Turn these on" }).click();
  await page.getByText(/everything else is off/).waitFor();
  await shot(page, "02-jobs");
  await caption(page, "jobsOn");
  await page.getByRole("link", { name: "Connection", exact: true }).click();
  await page.waitForURL(/\/connect/);
  await pause(1200);
  await caption(page, "connect");
  await shot(page, "03-connect");

  // 4. The sample: connected and tested automatically
  await goto(page, "/");
  await page.locator("#pick-app").scrollIntoViewIfNeeded();
  await caption(page, "sample");
  await page.getByRole("button", { name: /Petstore \(sample\)/ }).first().click();
  await page.waitForURL(/\/review\?new=1/, { timeout: 90_000 });
  await pause(1500);
  await caption(page, "sampleReady");
  await page.locator("#jobs-title").scrollIntoViewIfNeeded();
  await page.getByRole("checkbox", { name: /Browse the pet shop/ }).check();
  await page.getByRole("checkbox", { name: /Add new pets/ }).check();
  await page.getByRole("button", { name: "Turn these on" }).click();
  await page.getByText(/everything else is off/).waitFor();
  await caption(page, "sampleJobs");

  // 5. Publish + hand-off
  await page.getByRole("link", { name: "Publish", exact: true }).click();
  await page.waitForURL(/\/published/);
  await pause(800);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByText(/shown once/i).first().waitFor();
  await caption(page, "publish");
  await page.getByRole("link", { name: /I've copied it/ }).click();
  await page.waitForURL(/\/published/);
  await pause(1000);
  await page.locator("#handoff-title").scrollIntoViewIfNeeded();
  await caption(page, "handoff");
  await shot(page, "04-publish");

  // 6. Talk to it
  await page.getByRole("link", { name: "Test console", exact: true }).click();
  await page.waitForURL(/\/console/);
  await pause(1200);
  await caption(page, "talk");
  const consent = page.getByRole("button", { name: /I understand/ });
  if (await consent.isVisible()) {
    await caption(page, "consent");
    await consent.click();
  }
  await page.fill("#talk-input", "Which pets are available right now? Just the first five names.");
  await page.keyboard.press("Enter");
  await page.getByText(/Used find_pets_by_status/).waitFor({ timeout: 90_000 });
  await pause(1500);
  await caption(page, "answered");
  await shot(page, "05-talk");
  await page.fill("#talk-input", "Add a new pet called Demo Biscuit with id 4242999, status available, no photos.");
  await page.keyboard.press("Enter");
  await page.getByText(/waiting for approval/).first().waitFor({ timeout: 90_000 });
  await pause(1500);
  await caption(page, "write");

  // 7. Approvals
  await goto(page, "/approvals");
  await caption(page, "approvals");
  await shot(page, "06-approvals");
  await page.getByRole("button", { name: "Approve and run" }).first().click();
  await page.getByText(/Approved · done/).first().waitFor({ timeout: 60_000 });
  await pause(1200);
  await caption(page, "done");

  // 8. Health and activity
  await goto(page, "/");
  await page.getByRole("link", { name: /Petstore \(sample\)/ }).first().click();
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await page.waitForURL(/\/activity/);
  await pause(1000);
  await caption(page, "activity");
  await shot(page, "07-activity");
  await caption(page, "outro", 2500);

  await context.close();
  await browser.close();

  // 9. Lay each clip at the moment its caption appeared, and write the MP4.
  const video = readdirSync(RAW).find((f) => f.endsWith(".webm"));
  if (!video) throw new Error("Playwright saved no video.");
  const inputs = cues.flatMap((c) => ["-i", clips[c.id].file]);
  const delays = cues.map((c, i) => `[${i + 1}:a]adelay=${c.at}|${c.at}[a${i}]`).join(";");
  const mix = `${cues.map((_, i) => `[a${i}]`).join("")}amix=inputs=${cues.length}:normalize=0:duration=longest[voice]`;
  const out = join(OUT, "walkthrough.mp4");
  execFileSync(
    FFMPEG!,
    [
      "-y", "-loglevel", "error",
      "-i", join(RAW, video), ...inputs,
      "-filter_complex", `${delays};${mix}`,
      "-map", "0:v", "-map", "[voice]",
      "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
      "-movflags", "+faststart",
      out,
    ],
    { stdio: "inherit" },
  );
  rmSync(RAW, { recursive: true, force: true });
  console.log(`Saved ${out} (${cues.length} narrated captions) and screenshots.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
