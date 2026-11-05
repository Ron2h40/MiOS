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
            <strong>Today:</strong> MiOS stores your tasks, settings and activity log only in this browser&apos;s local
            storage. Nothing is sent to a server. You can export or erase it all in Settings.
          </p>
          <p>
            <strong>When AI features turn on:</strong> at child and teen stage, your task data and activity log are sent
            to Google Gemini to power suggestions and a background analysis log. MiOS uses Gemini&apos;s free tier, and
            under Google&apos;s free-tier terms that data may be used to improve Google&apos;s products. Every AI
            suggestion will have a &ldquo;Why?&rdquo; button that shows its reasoning. At adult stage nothing is sent.
          </p>
          <p>
            <strong>Medicine presets</strong> (coming soon) are for personal tracking only and are not medical advice.
          </p>
        </div>
      </Card>
    </div>
  );
}
