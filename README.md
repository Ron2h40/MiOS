# MiOS

**An operating system for your brain.** MiOS borrows how a computer OS manages tasks, resources and priority (process states, a scheduler, interrupts, deadlock detection) and turns those rules into daily thinking practice. AI helps at first, then steps back as you get stronger.


## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests for the OS core
npm run typecheck
npm run lint
npm run build
```

On first launch, click **Load example tasks** to see a deadlock, a starved task and the cross-mode load.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router) + React 19 + TypeScript (strict) | Server route handlers are ready for the Gemini proxy and Google Calendar OAuth without a separate backend |
| State | Zustand + `persist` (localStorage, versioned schema) | Small, testable, no boilerplate; storage can later move to a server without touching the UI |
| Styling | CSS Modules + design tokens in `globals.css` | Styling stays separate from logic, so a redesign is a restyle, not a rewrite |
| Tests | Vitest | Fast unit tests for the pure domain core |

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
│   ├── referee.ts     A6 protected time blocks (overnight, weekdays)
│   ├── timeGuess.ts   A9 estimate vs actual accuracy
│   ├── modes.ts       Mode registry + A8 cross-mode load ("glue")
│   ├── stages.ts      Assistant stage policy + progress gate (auto stage-up)
│   ├── events.ts      Metrics event log types
│   └── __tests__/     30 unit tests
├── state/           Zustand store: wires core rules to persistence + event log
│   ├── store.ts       All mutations; every user decision is logged as an event
│   └── hooks.ts       Derived read-side hooks (useStage, useGate, useDeadlocks …)
├── features/        Screens, one folder per feature (tasks, focus, progress, settings, shell)
├── ui/              Presentational primitives (Button, Card, Dialog, pills, toast)
└── app/             Next.js routes only, thin wrappers around feature screens
    ├── (os)/          Routes inside the app shell: /m/[mode], /progress, /settings, /privacy
    └── focus/         A7 focus view, outside the shell so everything else is hidden
```

Dependencies point one way: `app → features → state → core`. The core never imports from the layers above it, which is how "the core runs without AI" is enforced structurally.

### Key design decisions

- **One place for stage rules.** `STAGE_POLICY` in `core/stages.ts` says what each stage allows (AI active, AI button, pop-up first). Every AI feature reads the stage through `useStage()`.
- **Progress gate as data.** Thresholds live in the `GATES` table, so tuning with beta data is a one-line change. The evaluator only counts events logged at the current stage since the user last entered it, which implements the stage-back rule. All-time stats are computed from the full log and never reset.
- **Metrics from day one.** Task completions (with on-time and own-choice flags), decisions with or without AI, interrupt choices, deadlock breaks, referee overrides and stage changes are all appended to an event log. The log feeds the gate now and the success metrics later.
- **MiOS never decides for the user.** Sorting by priority is a button the user presses. Interrupts show a preview and wait for a choice. Deadlocks are shown, and the user picks which link to break.
- **Blocked tasks wake up.** When every blocker clears, the task moves back to Ready, the way an OS wakes a waiting process.
