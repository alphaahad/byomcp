# Design: BYOMCP

Status: **UnleashX design language is live (slice 7).** Deduced from four UnleashX screenshots (Home, AI Workforce, Leasha chat, Add Tool), so BYOMCP feels native to the product it plugs into. Everything below the "History" line is the record of earlier directions (retro A/B/C, then Apple principles), kept so the reasoning is traceable.

## Live: UnleashX language

| Element | What UnleashX does | BYOMCP |
|---|---|---|
| Shell | White left sidebar: brand, workspace, nav with icons, quiet uppercase section labels, cards at the bottom. Top bar: breadcrumb, outline buttons, bell with red badge | `AppShell`: Home, Add an app, Approvals (badge), How it works; YOUR APPS with a published dot; "AI cost so far" card. Top bar: breadcrumb, How it works, approvals bell |
| Colour | Light grey canvas, white cards, one violet primary, tinted category pills | Tokens below; AA checked by script in both themes |
| Type | Friendly geometric sans, medium-weight headings, violet accent words in the hero | **Outfit** 400–700 via `next/font` (self-hosted at build) |
| Cards | 1px border, ~10px radius, faint shadow; avatar + title + metrics row + footer button | `.window`, `Monogram`, `MetricRow`; app cards end in a "Next: …" button |
| Progress | Leasha's "Active plan": progress bar + checklist | `SetupPanel` on every app page |
| Tabs, tags | Underline tabs with a violet bar; small tinted tags | `.tabs`; `Tag` (risk, evidence, health, AI used / No AI) |
| Empty states | One sentence that says what to click | Every empty state names the next action |

**Tokens (light / dark):** canvas `#f7f7f9` / `#0e0e12` · surface `#ffffff` / `#17171c` · separator `#e7e7ec` · ink `#1f1f29` · ink-soft `#6b6b7b` · signal (violet) `#6d28d9` / `#a78bfa`, tint `#f3eeff` · ok `#15803d` · warn `#c2410c` · info `#1d4ed8` · alarm `#b91c1c` · badge `#dc2626`.

**Principles:** one obvious next step on every screen (Setup panel, app-card buttons) · say where AI is (AI used / No AI tags, spend in the sidebar) · plain words first, technical detail one click down ("Details", "Raw MCP messages") · colour never the only signal (every tag is a word) · reduced motion and higher contrast respected; visible violet focus ring; light and dark.

**Layout:**

```
┌ sidebar ───────┬ Home › Zendesk                     [How it works] [🔔1] ┐
│ B BYOMCP       │ [Z] Zendesk  ● Published · 4 of 675 actions on        │
│ Demo workspace │ Actions  Connection  Publish  Test console  Health …  │
│ Home           │ ┌ content ───────────────────────┐ ┌ Setup  4 of 6 ┐ │
│ Add an app     │ │ What your AI employee can do   │ │ ███████░░░    │ │
│ Approvals   1  │ │ Read · Changes data · Destr.   │ │ ✓ Read docs   │ │
│ How it works   │ │ [search]  [Only on]            │ │ ✓ Choose      │ │
│ YOUR APPS      │ │ ▸ Tickets  36 actions · 4 on   │ │ ✓ Connect     │ │
│  Z Zendesk  ●  │ │   ◉ On  List Tickets  Read …   │ │ 4 Test one    │ │
│ AI COST $0.01  │ └────────────────────────────────┘ │ [Next: Try →] │ │
└────────────────┴─────────────────────────────────────┴───────────────┘─┘
```
On a phone the sidebar becomes a menu and the Setup panel shrinks to the next step above the content (below it once setup is done).

---

## History

## The brief, in one line

A calm, trustworthy tool that takes a CS or ops person from "I have docs" to "my AI employee can use this app safely". Retro, and **not** the generic AI look (no cream + terracotta, no black + acid green, no rows of identical rounded cards, no ALL-CAPS eyebrows, no `→` on every button, no purple gradients, no Inter-on-white).

## What every direction must carry (non-negotiable)

These come from SPEC section 8 and stay the same whichever look we choose.

| Need | How it shows up |
|---|---|
| Plain language first | Action titles ("Create a ticket") are the largest text in a row. `POST /tickets` lives under **Advanced**. |
| Evidence, not confidence | Every action shows **Tested**, **Sourced** or **Needs review** as a word plus a mark, never colour alone. Sourced opens the doc quote. |
| Risk tiers | **Read**, **Write**, **Destructive** as words plus a mark. Destructive is the only thing that uses the alarm colour. |
| Safe by default | Toggle state is visible and explained ("Off: writes start off. Turn on to let your AI employee use it."). |
| One primary action per screen | One filled button per screen, named for exactly what it does: "Publish" → "Published". |
| Cost is visible | A persistent line: "AI import cost: $0.004 · Running this connector: $0.00 per call". |
| Accessibility | WCAG AA contrast for text, visible focus on everything, keyboard-only flow works, `prefers-reduced-motion` respected, light and dark. |

## The six semantic colours (named the same in every direction)

`paper` (background) · `ink` (text) · `rule` (lines, borders, quiet UI) · `signal` (primary action, links, focus) · `ok` (Tested, success) · `alarm` (Destructive, failures)

"Needs review" and "Write" use `ink` with a pattern or mark, not a seventh colour. That keeps the palette small and the alarm colour meaningful.

---

## Direction A: Teletype ledger

A connector as a printed run log. Green-bar continuous paper, typed records, tractor-feed margins. Dark mode is an amber phosphor terminal.

**Why it fits:** the product turns docs into records and records into calls. A ledger says "every line is accounted for", which is the trust story.

| Token | Light (green-bar paper) | Dark (amber phosphor) |
|---|---|---|
| paper | `#FBFCF8` with alternating `#E5EFE0` bands | `#15110A` |
| ink | `#1F2A22` | `#FFC766` |
| rule | `#9DB59A` | `#6B5221` |
| signal | `#1F4FA3` (carbon blue) | `#FFE2A8` (bright phosphor, underlined) |
| ok | `#2E6B34` | `#9FD27A` |
| alarm | `#B42318` (ribbon red) | `#FF7A59` |

**Type:** headings in **VT323** (terminal bitmap, used large only); body and data in **IBM Plex Mono**; long help text in **IBM Plex Sans** so paragraphs stay readable.

**Signature details:** banded rows instead of cards · perforated left margin with tractor holes as a page edge · evidence printed as ledger codes `[T] Tested` `[S] Sourced` `[?] Needs review` · a blinking caret only while the AI is reading (static with reduced motion).

**Risk:** monospace everywhere can feel technical to a CS user. Mitigation: titles and help text in Plex Sans; mono only for codes and data.

```
 o |  BYOMCP  ::  FRESHDESK  ::  REVIEW ACTIONS            [ Publish ]   | o
 o |  AI import cost $0.004   ·   running cost $0.00 per call           | o
 o |------------------------------------------------------------------- | o
 o |  TICKETS                                                           | o
 o |  [on ] Get a ticket          READ         [S] Sourced  "View a..."  | o
 o |░░[on ] List tickets          READ         [T] Tested   12s ago    ░░| o
 o |  [off] Create a ticket       WRITE        [S] Sourced  needs appr.  | o
 o |░░[off] Delete a ticket       !DESTRUCTIVE [?] Needs review        ░░| o
 o |        > Advanced: DELETE /api/v2/tickets/{id}                     | o
```

---

## Direction B: Shipping manifest

Each connector is cargo being cleared through a port: a manifest with ruled columns, carbon-copy blue typing, and rubber stamps for decisions. Ties to the "Dockyard" working name without leaning on boat clichés.

**Why it fits:** review is literally inspection and clearance. "Tested" and "Approved" as stamps make evidence feel earned, not decorative.

| Token | Light (manifest form) | Dark (night shift) |
|---|---|---|
| paper | `#EEF1F3` (blue-grey form stock) | `#121820` |
| ink | `#1B2330` | `#E4E9EF` |
| rule | `#A9B4C2` (printed form lines) | `#3A4656` |
| signal | `#23408E` (carbon-copy blue) | `#8FB0FF` |
| ok | `#1E6B52` (inspection green stamp) | `#6FD3A8` |
| alarm | `#C8102E` (customs red stamp) | `#FF6B7D` |

**Type:** headings in **Big Shoulders Stencil Display** (crate stencil, headings only); typed field values in **Courier Prime**; UI and body in **Public Sans** (a government-forms sans, very legible).

**Signature details:** ruled form with numbered columns, not cards · evidence and approvals as slightly rotated rubber stamps (`TESTED`, `NEEDS REVIEW`) with a no-rotation fallback for reduced motion · section tabs like a binder divider · a perforated "tear-off" strip holding the MCP URL and token on the Publish screen.

**Risk:** stamps can get cute. Mitigation: stamps only for evidence and approval decisions; everything else is plain form.

```
 ┌ MANIFEST No. 0003 ── Freshdesk ───────────────────── v2 draft ─┐
 │ AI import cost $0.004 · Running cost $0.00 per call  [ Publish ]│
 ├──┬────────────────────┬──────────────┬─────────────┬───────────┤
 │# │ Action             │ Risk         │ Evidence    │ Use       │
 ├──┼────────────────────┼──────────────┼─────────────┼───────────┤
 │01│ Get a ticket       │ Read         │ ⟦SOURCED⟧   │ [■] On    │
 │02│ List tickets       │ Read         │ ⟦TESTED⟧    │ [■] On    │
 │03│ Create a ticket    │ Write        │ ⟦SOURCED⟧   │ [ ] Off   │
 │04│ Delete a ticket    │ ▲Destructive │ ⟦NEEDS REV⟧ │ [ ] Off   │
 │  │   Advanced ▸ DELETE /api/v2/tickets/{id}                     │
 └──┴────────────────────────────────────────────────────────────┘
```

---

## Direction C: 90s system utility

A well-made control panel from 1995: platinum chrome, bevelled buttons, real window title bars, a status bar at the bottom. Friendly and familiar to anyone who has used a computer, which suits non-technical users.

**Why it fits:** a "utility that does one job safely" is exactly what a connector builder should feel like. Checkboxes, group boxes and a status bar are the original plain-language UI.

| Token | Light (platinum) | Dark (high-contrast scheme) |
|---|---|---|
| paper | `#D4D0C8` chrome, `#FFFFFF` wells | `#000000` chrome, `#101010` wells |
| ink | `#000000` | `#FFFFFF` |
| rule | `#808080` / `#FFFFFF` bevel pair | `#7F7F7F` / `#C0C0C0` |
| signal | `#000080` (title-bar navy) | `#1AEBFF` (HC cyan) |
| ok | `#007A33` | `#3FFF5F` |
| alarm | `#B00000` | `#FF5C5C` |

**Type:** window titles in **Silkscreen** (pixel, small caps-free); everything else in **Atkinson Hyperlegible** (built for low-vision legibility, which keeps the retro look accessible).

**Signature details:** each step is a window with a title bar · bevelled buttons that press in on click · group boxes ("Safety", "Evidence") instead of cards · a status bar: `Ready · 14 actions · 9 on · AI cost $0.004 · Runtime $0.00` · progress as a segmented blue bar while AI reads.

**Risk:** can tip into parody or feel dated. Mitigation: modern spacing and type sizes, no fake desktop or Start menu, chrome only on primary surfaces.

```
 ╔═ Freshdesk — Review actions ═══════════════════════════[_][□][x]╗
 ║ ┌ Tickets ────────────────────────────────────────────────────┐ ║
 ║ │ [x] Get a ticket        Read          ✓ Sourced  (quote…)   │ ║
 ║ │ [x] List tickets        Read          ✓✓ Tested  12s ago    │ ║
 ║ │ [ ] Create a ticket     Write         ✓ Sourced  approval   │ ║
 ║ │ [ ] Delete a ticket     ⚠ Destructive ? Needs review        │ ║
 ║ │       [ Advanced... ]                                       │ ║
 ║ └─────────────────────────────────────────────────────────────┘ ║
 ║                                         [ Cancel ]  [ Publish ] ║
 ╟─────────────────────────────────────────────────────────────────╢
 ║ Ready │ 14 actions · 2 on │ AI cost $0.004 │ Runtime $0.00/call  ║
 ╚═════════════════════════════════════════════════════════════════╝
```

---

## Checked against the brief

| Brief item | A Ledger | B Manifest | C Utility |
|---|---|---|---|
| Calm, trustworthy for non-tech users | Medium (mono can feel technical) | High | High |
| Evidence feels earned | Ledger codes | Stamps (strongest) | Checkmarks |
| Avoids generic AI look | Yes | Yes | Yes |
| Dark mode quality | Strongest (phosphor) | Good | Good (HC scheme) |
| Accessibility risk | Mono readability | Stamp rotation (fallback ready) | Low (Atkinson) |
| Build cost by Friday | Low | Medium | Medium (bevels) |

**My lean:** B, the shipping manifest. It is the only one where the metaphor does real product work: inspection, clearance and stamps map directly to evidence, approvals and publishing. A is the cheapest to build; C is the most familiar to non-technical users.

## Layout concept (shared)

```
Desktop                                   Phone
┌───────────────────────────────────┐     ┌──────────────┐
│ BYOMCP   Apps  Approvals(2)  Test │     │ BYOMCP    ≡  │
├────────┬──────────────────────────┤     ├──────────────┤
│ Steps  │ Current step             │     │ Step 3 of 6  │
│ 1 Docs │  (one primary action)    │     │ Current step │
│ 2 Read │                          │     │              │
│ 3 Rev. │                          │     │              │
│ 4 Conn │                          │     │ [ Primary ]  │
│ 5 Try  │                          │     └──────────────┘
│ 6 Pub. │ cost line                │
└────────┴──────────────────────────┘
```

## Open questions for round 1

1. Which direction (or which parts of each)?
2. How loud should the retro be: full costume on every screen, or retro chrome around a quieter content area?
3. Any reference you love (an old app, a printed form, a game UI) I should look at?
