# The Agent Console — Full Redesign Plan

> Status: **PLAN — awaiting approval.** No code changes yet.
> Scope: UI only. Zero backend changes. Every existing API contract preserved.

---

## 1. The concept: one world, called "The Console"

Today the agent experience is four wizard steps, a table, and a modal. It reads like CRUD
software. The redesign makes it a **place** — a private workshop where an investor forges
their own analyst. The metaphor is a watchmaker's bench, not a form: precise, personal,
quietly premium. Nothing about it should feel like developer tooling; it should feel like
a trader's private terminal crossed with an atelier.

Terminology changes (your one constraint — keep "Agent" — is respected):

| Today | Becomes | Why |
|---|---|---|
| Agent | **Agent** (kept) | per your instruction |
| Skills tab / step | **Capabilities** | "skills" reads like a résumé bullet; "capabilities" reads like an arsenal |
| Skill browser | **Armory** | where capabilities are forged and equipped |
| Attach / add skill | **Equip** | equipping a warrior |
| Skill weight (1–10) | **Conviction** | finance-native word for exactly what the number means |
| Draft with AI | **Commission** | you commission your agent, like commissioning a portrait |
| Persona | **Mind** | the agent's philosophy and beliefs |
| Configuration | **Doctrine** | horizon + risk are the agent's operating doctrine |
| Agents tab | **Console** | the whole world gets one name |

## 2. Design language for the world

This sub-app gets its own atmosphere inside the existing app, without breaking the design
system (the redesign skill's rules are followed: no framework migration, no breakage):

- **The Bench surface.** Console pages sit on a slightly deeper canvas than the rest of
  the app (a tinted dark layer, one hue family — cool graphite), with a subtle grain
  overlay and a single ambient radial light behind the hero. The rest of the app stays
  untouched; crossing into the Console should feel like walking through a door.
- **One accent.** The app's teal stays for analysis pages; the Console adopts a single
  brass/amber accent (matching the existing `--skill-accent`) used only for "live metal":
  equipped capabilities, save/forge actions, the active agent. No gradients, no purple.
- **Typography.** Existing font stack, but the Console uses it louder: display-size agent
  names with tight tracking, tabular numerals for every number, small-caps labels for
  doctrine fields. Sentence case everywhere.
- **Motion.** Spring-based, weighty (motion is already in the project). Staggered entry
  on capability cards; a slow "breathing" pulse only on the one thing that is live
  (e.g. the equipped agent's avatar). Nothing bounces.

## 3. The Console (agents tab redesign)

Replaces the table with a **roster of agents as living profiles**:

- **Roster view.** Each agent is a full-width row-card: large avatar (DiceBear
  notionists, already in deps), display-size name, a one-line "creed" pulled from the
  philosophy's first sentence, doctrine chips (horizon, risk /10), and its equipped
  capabilities rendered as small metal-tinted sigils with conviction dots. Hover lifts
  the card with a tinted shadow; the row's right side shows last-run health
  ("62.5 · 3 days ago" style, read from existing analysis list APIs — display only).
- **Empty state = the Forge invitation.** A composed screen: "Every great analyst starts
  as a blank slate" with a single Forging action and three archetype seeds (Value hunter,
  Momentum rider, Quality compounder) that pre-fill a new agent — one click, fully
  editable afterwards.
- **The Armory stays reachable** from the Console header as its own permanent room, not
  a hidden modal behind a builder step.
- Layout is a single-column editorial list (not 3-card columns), max-width ~1100px,
  left-aligned headers.

## 4. The Forge (agent builder redesign)

Replaces the 4-step wizard + markdown tab + AI draft modal **with one workspace**:

- **Single continuous canvas.** No step wizard, no Next buttons. The agent is one tall
  scroll of three acts: **Doctrine → Mind → Capabilities**, with a sticky header that
  shows the agent's name, avatar, and status (Draft / Forged). A slim left rail shows
  the three acts as a progress spine (what's filled, what's empty) and smooth-scrolls —
  it replaces both the StepRail and the overview screen.
- **Act I — Doctrine.** Horizon as a segmented control (intraday/swing/positional/
  long-term), risk as a labeled dial — the slider becomes a horizontal gauge with
  finance-plausible zone labels (Capital preservation / Measured / Aggressive). One row,
  no section chrome.
- **Act II — Mind.** The philosophy textarea becomes a manuscript: generous line-height,
  serif-feel sizing, live character count framed as "the agent reads every word". No
  other fields — this is the soul, it deserves the whole act.
- **Act III — Capabilities.** Equipped capabilities as **cards on a workbench**: each
  shows name, category sigil, one-line purpose, and its Conviction as a draggable 1–10
  notched slider with a live "share of score" readout (weight ÷ total, computed
  client-side). Drag to reorder (display order only; backend contract unchanged).
  Empty slots render as ghost outlines: "Slot 3 — empty. Visit the Armory."
- **Editing modes collapsed into one.** Today: manual form + markdown editor + AI draft
  panel, three mental models. New: **everything edits in place**; an "Advanced: raw
  agent file" disclosure inside the same page opens the markdown view (existing
  `sectionToMarkdown`/`parseSection` lib, unchanged); "Commission with AI" opens the
  AI co-builder as a slide-over dock (see §6) — not a modal, not a separate tab.
- **Save model.** Keep the existing dirty-tracking, autosave draft, and save API
  exactly as-is, but the feedback becomes ambient: the sticky header shows a small
  forge-state indicator (Unsaved changes → Forging… → Forged ✓) instead of toast-first.

## 5. The Armory (capabilities redesign)

Replaces the table-modal with a **two-pane armory** (full-height slide-over):

- **Left rail: the racks.** Capabilities grouped by category (Valuation, Fundamentals,
  Qualitative, Market, Macro, Custom — existing categories, relabeled display-only).
  Each rack item: name + one-line purpose + "EQUIPPED" state on the agent being edited.
  Search across name/description. No tables anywhere.
- **Right pane: the inspection bench.** Selecting a capability renders its full document
  beautifully — parsed into sections (Method, Data, Anchors) with anchors shown as a
  checklist preview, data requirements as source sigils (reusing the existing
  `sourceLogos` system: SEC/NSE/Voyager/Reddit/YouTube/web). This is where a capability
  feels like a weapon: specs, provenance, what it measures.
- **Forge new / Commission.** Two creation paths on the bench: write the document
  manually with the existing validate/save API (live validation feedback preserved),
  or Commission — describe the capability in plain language, AI drafts the document
  into the same editor for review before forging. Existing `SkillService` endpoints
  only.
- **Equip action.** The bench's primary action equips to the current agent (or any
  agent from a picker when opened from the Console). Equipping from the Armory closes
  with the workbench card animating in — the "giving the warrior a weapon" beat.

## 6. The Co-builder (assistant-ui chat)

The hand-rolled chat (ChatPanel/ChatBubble) is replaced by **`@assistant-ui/react`
(already in package.json, unused) on a LocalRuntime**:

- **Runtime.** `useLocalRuntime` with a custom `ChatModelAdapter` whose `run()`
  streams from the existing `BuilderService` SSE endpoint (same request, same
  protocol — I will adapt the existing stream into assistant-ui's async-iterator
  contract; zero backend changes).
- **Features unlocked** (all built into the runtime, currently missing): streaming
  tokens, message editing + branching (retry a commission from an earlier point),
  regeneration, copy, auto-scroll with scroll-lock, keyboard shortcuts, a11y roles,
  attachments (agent reference documents — reusing the existing upload API),
  run-status states, and suggestions.
- **Tool/approval UX.** The builder's draft-proposal flow (the current "apply changes"
  diff) maps onto assistant-ui's tool-call parts: when the AI proposes agent changes,
  the proposal renders as an inline "commission sheet" card with Approve / Edit /
  Discard — wired to the existing `diffDraft` + apply logic.
- **Sources.** Assistant messages that cite documents render source chips using the
  existing `sourceLogos` marks.
- **Model selection + reasoning.** The composer gets a model picker (existing
  `isServerFreeModel`/models list) and renders reasoning/thought parts collapsed by
  default with an expand control.
- **Visual integration.** assistant-ui is headless; every primitive is themed with the
  Console design language (brass accent, graphite surfaces, tabular numerals) — it
  will not look like a bolted-on widget. It replaces the chat in the Commission
  slide-over dock in the Forge.
- **Fallback plan.** If `0.15.x`'s API surface fights the existing SSE protocol on a
  specific feature (branching with server-side drafts, say), that feature stays on the
  ExternalStoreRuntime path rather than changing the backend; the rest of the runtime
  features ship regardless.

## 7. Information architecture after the redesign

```
/console                 → roster (agents) + Armory entry  [replaces /agents]
/agent/:id               → the Forge workspace             [replaces wizard]
  ├ act: Doctrine · Mind · Capabilities (one scroll)
  ├ dock: Commission (assistant-ui chat)
  └ disclosure: raw agent file (markdown)
/armory                  → full-page Armory                [new route; modal retained
                                                            for in-Forge quick equip]
```

Old routes redirect. Nav label becomes "Console".

## 8. Build order & testing gates

Each phase ships green (tsc + vitest + live preview check) before the next starts:

1. **Console shell & roster** — route rename, redirect, roster cards, empty state.
2. **The Forge** — single-canvas acts, spine rail, doctrine/mind redesigns, workbench
   capabilities, save-state ambient feedback. All existing save/autosave paths tested.
3. **The Armory** — slide-over two-pane, document rendering, equip flow, create/validate.
4. **The Co-builder** — assistant-ui LocalRuntime over the existing SSE stream, themed,
   proposal sheets, attachments, model picker. Chat is the last piece so a package
   problem can never block the core redesign.
5. **Polish pass** — motion, grain/light surfaces, empty/error/loading states per the
   redesign skill's checklist, mobile behavior of every new surface.

Risks I'm watching: assistant-ui version drift against React 19 (already pinned in
package.json — I'll verify the installed version's API before wiring); the SSE→runtime
adapter being the only genuinely new code; and keeping the 50 existing tests green
(AnalysisResult tests are untouched; agent-page tests will be updated to the new DOM).
