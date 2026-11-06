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
            browser&apos;s local storage. There is no MiOS account or database. You can export or erase it all in
            Settings.
          </p>
          <p>
            <strong>What goes to AI.</strong> At child and teen stage, MiOS sends parts of your data to Google Gemini:
            your open tasks (titles, deadlines, priorities, time guesses) and short lines from your activity log. This
            happens when you use an AI feature, and in a background review after you make a decision, finish a task, or
            use AI. The review writes notes about your habits so later suggestions fit you better. It runs silently, and
            every AI suggestion has a &ldquo;Why?&rdquo; button that shows its reasoning.
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
            <strong>Medicine presets</strong> (coming soon) are for personal tracking only and are not medical advice.
          </p>
        </div>
      </Card>
    </div>
  );
}
