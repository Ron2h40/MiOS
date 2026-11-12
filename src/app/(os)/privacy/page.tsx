import type { Metadata } from "next";
import { Card } from "@/ui/primitives";
import s from "@/features/progress/progress.module.css";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <div className={s.screen}>
      <header>
        <h1 className={s.pageTitle}>Privacy</h1>
        <p className={s.lead}>Short and plain.</p>
      </header>
      <Card>
        <div className={s.prose}>
          <p>
            <strong>Where your data lives.</strong> MiOS stores your tasks, settings, activity log and AI notes in this
            browser&apos;s local storage. You can export or erase it all in Settings.
          </p>
          <p>
            <strong>Accounts.</strong> An account is optional. If you sign in (with Google, or with an email and
            password), MiOS also keeps a copy of your data in Google Firebase, so it follows you to other devices. Only
            you can read it: the database refuses everyone else, and sync starts once your email is confirmed. Firebase
            stores your email address and, for Google sign-in, your name. Signing out removes your data from this
            browser; it stays in your account. Erasing everything in Settings while signed in erases it from your
            account too. As a guest, nothing is stored outside this browser.
          </p>
          <p>
            <strong>AI allowance.</strong> Signed-in accounts get real AI, up to 100 requests a day. For now guests get
            real AI too; later, guests will get demo answers and real AI will need an account. MiOS counts AI requests
            per account, or per network address for guests, and keeps only today&apos;s count.
          </p>
          <p>
            <strong>What goes to AI.</strong> At child and teen stage, MiOS sends parts of your data to Google Gemini:
            your open tasks (titles, deadlines, priorities, time guesses) and short lines from your activity log. This
            happens when you use an AI feature, and in a background review after you make a decision, finish a task, or
            use AI. The review writes notes about your habits so later suggestions fit you better. It runs silently, and
            every AI suggestion has a &ldquo;Why?&rdquo; button that shows its reasoning.
          </p>
          <p>
            <strong>Research, steps and reviews.</strong> When you ask a research question, the question and the task
            title go to Gemini, which searches with Google Search. If Google Search isn&apos;t available on MiOS&apos;s
            key, MiOS searches Wikipedia instead, and the question goes to Wikipedia too. Breaking a task into steps and
            the review after a big task send that task to Gemini. Your own summaries and review answers stay in this
            browser. At adult stage none of this goes anywhere: steps and the review still work, with no AI.
          </p>
          <p>
            <strong>Google&apos;s free tier.</strong> MiOS uses Gemini&apos;s free tier. Under Google&apos;s free-tier
            terms, what MiOS sends and what Gemini answers may be used to improve Google&apos;s products, and people at
            Google may review it. Don&apos;t put anything in a task you wouldn&apos;t want shared that way.
          </p>
          <p>
            <strong>Adult stage.</strong> Nothing is sent to AI at adult stage.
          </p>
          <p>
            <strong>Calendars.</strong> Calendar files you import stay in this browser and are never sent to AI. An item
            you add to MiOS in the morning check-in becomes a normal task, and is treated like any other task.
          </p>
          <p>
            <strong>Medicine presets</strong> are for personal tracking only and are not medical advice.
          </p>
        </div>
      </Card>
    </div>
  );
}
