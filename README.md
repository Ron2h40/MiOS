# MiOS

A task manager that works like an operating system, and an AI assistant that gives you less help as you get better at planning on your own.

Live demo: https://mios-three.vercel.app

## Features

- Tasks move through Ready, Running, Blocked and Done, like processes in an OS
- Manual or priority-based scheduling, interrupt previews, and deadlock detection for tasks that block each other
- A focus view that shows one task at a time
- Time-guess practice: guess how long a task takes, then see how close you were
- An AI assistant (Google Gemini) with three levels: it helps a lot at first, then asks you to think first, then switches off
- Focus, Energy and Hydration charts that change with what you eat, drink, sleep and take
- Daily medicine reminders with a 30-day log
- Daily streaks and weekly and monthly stats cards
- `.ics` import and export, and two-way Google Calendar sync
- Works without an account; sign in with Google or email to sync across devices

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router), React 19, TypeScript
- [Zustand](https://github.com/pmndrs/zustand) for state, saved to localStorage
- CSS Modules
- [Google Gemini API](https://ai.google.dev) for the AI features
- [Firebase](https://firebase.google.com) Auth and Firestore for accounts and sync
- [ical.js](https://github.com/kewisch/ical.js) and the Google Calendar API
- [Vitest](https://vitest.dev) for tests

## Getting started

You need Node.js 22 or newer.

```bash
git clone https://github.com/Ron2h40/MiOS.git
cd MiOS
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. Click **Load example tasks** on the first screen to see the app with sample data.

Every setting in `.env.local` is optional. Without a Gemini key, the AI features return demo answers.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Build for production |
| `npm start` | Run the production build |
| `npm test` | Run the tests |
| `npm run typecheck` | Check types |
| `npm run lint` | Lint the code |

## Configuration

Settings go in `.env.local`. See [`.env.example`](.env.example) for the full list.

| Variable | Used for |
| --- | --- |
| `GEMINI_API_KEY` | AI features. Get a free key at [Google AI Studio](https://aistudio.google.com/apikey). Server only |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL` | Override the default Gemini models |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google Calendar sync |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID` | Accounts and sync |
| `NEXT_PUBLIC_GUEST_AI` | `real` (default) or `demo` for people who aren't signed in |
| `NEXT_PUBLIC_GOOGLE_CALENDAR_OPEN` | Set to `1` once Google has verified the app's calendar access |
| `NEXT_PUBLIC_FEEDBACK_URL` | Link for the Feedback button |

### Google Calendar

1. In [Google Cloud Console](https://console.cloud.google.com), enable the Google Calendar API.
2. Under Google Auth Platform, set up the consent screen as External and add yourself as a test user.
3. Create an OAuth client of type Web application, with `http://localhost:3000` as an authorized JavaScript origin.
4. Put the client ID in `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

While the app is in testing mode, only test users can connect, and Google asks them to approve again every 7 days.

### Firebase

1. In the [Firebase console](https://console.firebase.google.com), create a project or add Firebase to your Google Cloud project.
2. Enable the Google and Email/Password sign-in methods.
3. Create a Firestore database in production mode.
4. Publish the rules from [`firestore.rules`](firestore.rules).
5. Register a web app and copy its config into the four `NEXT_PUBLIC_FIREBASE_*` variables.

The Firebase web config is public by design. The security rules are what protect the data.

## Deploying

The app runs on [Vercel](https://vercel.com) with the default Next.js settings.

1. Import the repository in Vercel.
2. Add the same environment variables as in `.env.local`.
3. Deploy.
4. Add the new domain to Firebase (Authentication → Settings → Authorized domains) and to the OAuth client's JavaScript origins.

`NEXT_PUBLIC_*` values are built into the page, so redeploy after changing them.

## Project structure

```
src/
├── core/           Task rules, scheduler, deadlocks, stages, resources, rewards, calendar (plain TypeScript)
├── ai/             Prompts, response validation, demo answers, Gemini client
├── integrations/   .ics files, Google Calendar, Firebase
├── state/          Zustand stores and sync
├── features/       Screens, one folder per feature
├── ui/             Shared components
└── app/            Next.js routes and the /api/ai route
```

`src/core` doesn't depend on React, Next.js or the AI code, so all the task logic runs and is tested on its own. Every AI request goes through `/api/ai`, which keeps the API key on the server and checks each model response before the app uses it.
