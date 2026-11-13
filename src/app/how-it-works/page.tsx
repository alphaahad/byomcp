import { AppShell } from "@/components/app-shell";
import { AiTag, ButtonLink, PageHeader, Window } from "@/components/ui";

export const metadata = { title: "How it works · BYOMCP" };

const STEPS = [
  {
    title: "1. Bring the docs",
    what: "Paste a link to the app's API docs (or upload its OpenAPI file, or paste docs text).",
    you: "A list of everything the app's API can do, in plain language, grouped by topic. Each one shows where it came from: a quote from the docs you can check.",
    ai: true,
    aiNote: "AI reads docs pages once, here and only here. Typical estimated cost: under $0.01. OpenAPI files are read without AI, for free.",
  },
  {
    title: "2. Choose what it can do",
    what: "Turn on the actions your AI employee needs. Leave the rest off.",
    you: "Reads (looking things up) can run on their own. Anything that changes data can wait for your approval; destructive actions (deleting, refunding) always do.",
    ai: false,
  },
  {
    title: "3. Connect and test",
    what: "Add the key your AI employee will act with, then run one action for real.",
    you: "Your key is encrypted and never shown again, never sent to AI. A successful test marks the action Tested.",
    ai: false,
  },
  {
    title: "4. Publish and use",
    what: "Publish to get an MCP address and an access token.",
    you: "Add it to UnleashX (or Claude, or any MCP client). Every call is logged; Health tells you if the app stops accepting your key.",
    ai: false,
    aiNote: "Running your app never calls AI: $0 per call.",
  },
];

const FAQ = [
  {
    q: "What's an MCP server, in plain words?",
    a: "MCP (Model Context Protocol) is the standard way AI assistants and AI employees use other apps. An MCP server is the adapter: it tells the AI what it can do in an app (\"create a ticket\", \"look up an employee\") and runs those actions safely. BYOMCP builds that adapter for you from the app's docs.",
  },
  {
    q: "How do I use it in UnleashX?",
    a: "After you publish, copy the MCP address and token from the Publish tab, and add them as a custom MCP app in UnleashX. The app's actions then show up in the workflow builder and for your AI employees.",
  },
  {
    q: "Where exactly is AI used, and what does it see?",
    a: "Only when reading docs pages or pasted docs text, once per import. The AI sees the public docs text, nothing else: never your keys, never your app's data. The estimated cost (at Google's list prices) is shown on every app. After that, everything is plain code that runs exactly the actions you approved.",
  },
  {
    q: "What if the AI gets the docs wrong?",
    a: "Every action shows its evidence. \"From the docs\" means we found the exact quote in the docs; if we couldn't, it says \"Needs review\". Try it runs the action for real before you publish, and you can edit anything under Advanced.",
  },
  {
    q: "Can my AI employee delete or change things without me knowing?",
    a: "Only if you allow it. Actions that change data start off and can require approval; destructive ones always require it. Approvals land in the Approvals inbox with the exact request, and run exactly once when you approve.",
  },
  {
    q: "What happens if my key stops working?",
    a: "The next call fails with a clear reason, the app is marked Needs reconnect (on Home, the app's Health tab and its Setup panel), and you paste a new key in Connection.",
  },
];

export default function HowItWorksPage() {
  return (
    <AppShell crumbs={[{ label: "How it works" }]}>
      <PageHeader
        title="How it works"
        lead="BYOMCP turns an app's API docs into a safe MCP server, so your AI employees can use apps that aren't connected yet. Four steps, about five minutes, no code."
        actions={
          <ButtonLink href="/" primary>
            Start with a link
          </ButtonLink>
        }
      />

      <ol className="flex flex-col gap-3">
        {STEPS.map((s) => (
          <li key={s.title} className="window p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[1.125rem] font-semibold">{s.title}</h2>
              <AiTag used={s.ai} />
            </div>
            <p className="mt-2">{s.what}</p>
            <p className="mt-1 text-ink-soft">{s.you}</p>
            {s.aiNote && <p className="mt-2 text-sm text-signal">{s.aiNote}</p>}
          </li>
        ))}
      </ol>

      <Window title="Questions">
        <div className="flex flex-col divide-y divide-[var(--separator)]">
          {FAQ.map((f) => (
            <details key={f.q} className="py-3">
              <summary className="cursor-pointer font-medium">{f.q}</summary>
              <p className="mt-2 text-ink-soft">{f.a}</p>
            </details>
          ))}
        </div>
      </Window>
    </AppShell>
  );
}
