# MiOS

**An operating system for your brain.** MiOS borrows how a computer OS manages tasks, resources and priority (process states, a scheduler, interrupts, deadlock detection) and turns those rules into daily thinking practice. AI helps at first, then steps back as you get stronger.


## Quick start

```bash
npm install
cp .env.example .env.local   # then add your free Gemini API key (optional)
npm run dev        # http://localhost:3000
npm test           # unit tests for the OS core and AI helpers
npm run typecheck
npm run lint
npm run build
```

On first launch, click **Load example tasks** to see a deadlock, a starved task and the cross-mode load.

Without `GEMINI_API_KEY`, every AI feature still works using demo answers, labeled "Demo AI" in the app. Get a free key at [Google AI Studio](https://aistudio.google.com/apikey).

### Google Calendar sync (optional)

1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable the **Google Calendar API**.
2. Under **Google Auth Platform**: set the app name and contact email, choose **External**, leave it in **Testing**, and add your Google account as a test user.
3. Create an OAuth client of type **Web application** with `http://localhost:3000` as an authorized JavaScript origin. No redirect URI or client secret is needed.
4. Put the client ID in `.env.local` as `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, then open **Calendar → Google Calendar → Connect**.

While the app is in Testing, Google shows an "unverified app" screen, allows up to 100 test users, and asks for approval again every 7 days.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router) + React 19 + TypeScript (strict) | Server route handlers for the Gemini proxy without a separate backend |
| State | Zustand + `persist` (localStorage, versioned schema) | Small, testable, no boilerplate; storage can later move to a server without touching the UI |
| Styling | CSS Modules + design tokens in `globals.css` | Styling stays separate from logic, so a redesign is a restyle, not a rewrite |
| AI | Google Gemini `gemini-3.1-flash-lite` via REST, behind a Next.js route | Cheapest stable model with a free tier (checked Nov 2026); the key never reaches the browser |
| Calendar | `ical.js` for .ics; Google Calendar API v3 with Google Identity Services (token model) | Time zones and repeat rules handled by a proven parser; Google sync runs in the browser with no server and no client secret |
| Tests | Vitest | Fast unit tests for the pure domain core and AI helpers |

## Architecture

```
src/
├── core/            Pure TypeScript domain. No React, no Next.js, no AI.
│   ├── types.ts       Task, ProcessState, Stage, Settings …
│   ├── process.ts     A1 process states + A6 running cap
│   ├── scheduler.ts   A2 queue ordering and finish-time projection
│   ├── interrupts.ts  A3 "what would this push back?"
│   ├── deadlock.ts    A4 dependency graph, Tarjan SCC cycle detection
│   ├── starvation.ts  A5 waiting-too-long flag
│   ├── referee.ts     A6 protected time blocks (overnight, weekdays) and busy calendar time
│   ├── timeGuess.ts   A9 estimate vs actual accuracy
│   ├── modes.ts       Mode registry + A8 cross-mode load ("glue")
│   ├── stages.ts      Assistant stage policy + progress gate (auto stage-up)
│   ├── events.ts      Metrics event log types
│   ├── resources.ts   C1/C4/C5 effect curves, levels, day series, task cost
│   ├── resourcePresets.ts  C3 presets; medicine facts with FDA label sources
│   ├── rewards.ts     D2/D5/D6 streak with freezes, period stats, records, when a drop is due
│   ├── wrap.ts        D1/D3/D4 stats-drop cards with compliments built from real numbers
│   ├── calendar.ts    E shared calendar: duplicate-proof merging, check-in status, busy time
│   ├── repeats.ts     Repeating tasks: patterns, exact times, one task per day
│   ├── agenda.ts      What's on each day, for every calendar view
│   └── __tests__/
├── ai/              AI assistant logic shared by browser and server. No React.
│   ├── types.ts       Request/response types per feature, pop-up question shape
│   ├── prompts.ts     Prompt + JSON-schema builders (stage-aware)
│   ├── validate.ts    Checks every model answer before the app uses it
│   ├── popup.ts       Teen pop-ups: history cleared at 30, random formats, shuffle
│   ├── backgroundLog.ts  B8 triggers and event descriptions
│   ├── mock.ts        Demo answers when no API key is set
│   └── server/gemini.ts  Server-only Gemini client
├── integrations/    Outside formats and services. No React.
│   ├── ics.ts         E1 .ics reader (ical.js: time zones, repeats) and writer (RFC 5545)
│   └── google/        E2 mapping.ts (pure sync rules) and client.ts (sign-in, Calendar API)
├── state/           Zustand stores: wire core rules to persistence + event log
│   ├── store.ts       All mutations; every user decision is logged as an event
│   ├── ai.ts          AI calls, background analysis log, pop-up stock and history
│   ├── google.ts      E2 sync run: MiOS calendar, pull changes, push tasks, read main calendar
│   └── hooks.ts       Derived read-side hooks (useStage, useGate, useDeadlocks …)
├── features/        Screens, one folder per feature (tasks, ai, calendar, focus, progress, resources, rewards, settings, shell)
├── ui/              Presentational primitives (Button, Card, Dialog, pills, toast)
└── app/             Next.js routes only, thin wrappers around feature screens
    ├── (os)/          Routes inside the app shell: /m/[mode], /calendar, /resources, /progress, /settings, /privacy
    ├── api/ai/        POST /api/ai: the single server entry point for AI
    └── focus/         A7 focus view, outside the shell so everything else is hidden
```

Dependencies point one way: `app → features → state → core`. The core never imports from the layers above it, which is how "the core runs without AI" is enforced structurally.

### Key design decisions

- **One place for stage rules.** `STAGE_POLICY` in `core/stages.ts` says what each stage allows (AI active, AI button, pop-up first). Every AI feature reads the stage through `useStage()`.
- **Progress gate as data.** Thresholds live in the `GATES` table, so tuning with beta data is a one-line change. The evaluator only counts events logged at the current stage since the user last entered it, which implements the stage-back rule. All-time stats are computed from the full log and never reset.
- **Metrics from day one.** Task completions (with on-time and own-choice flags), decisions with or without AI, interrupt choices, deadlock breaks, referee overrides and stage changes are all appended to an event log. The log feeds the gate now and the success metrics later.
- **MiOS never decides for the user.** Sorting by priority is a button the user presses. Interrupts show a preview and wait for a choice. Deadlocks are shown, and the user picks which link to break.
- **Blocked tasks wake up.** When every blocker clears, the task moves back to Ready, the way an OS wakes a waiting process.
- **AI is a layer, not a dependency.** `src/core` never imports AI. All AI calls go through one server route, which also refuses AI at adult stage. Every model answer is validated, and invented task ids or malformed times are dropped.
- **One door for AI help.** `AiHelpButton` applies the stage rules for every feature: direct at child stage, a pop-up question first at teen, hidden at adult.
