"use client";

import Link from "next/link";
import { useMios } from "@/state/store";
import { Button, Dialog } from "@/ui/primitives";

/**
 * MiOS says once, in onboarding and in privacy settings, that a
 * background AI reviews the user's activity and that data goes to an AI
 * service. This is that text, shared by both places.
 */
export function AiDisclosureText() {
  return (
    <>
      <p>
        At child and teen stage, MiOS uses Google Gemini to help. A background review also runs after you make a
        decision, finish a task, or use AI. It writes notes about your habits so later help fits you better. You
        won&apos;t get a notification for it. Tap <strong>Why?</strong> on any AI suggestion to see its reasoning.
      </p>
      <p>
        That means your tasks and activity log are sent to Google Gemini. MiOS uses Gemini&apos;s free tier, and under
        Google&apos;s free-tier terms that data may be used to improve Google&apos;s products. At adult stage nothing is
        sent. <Link href="/privacy">Read the privacy notice</Link>.
      </p>
    </>
  );
}

/** One-time welcome shown on first launch. */
export function Onboarding() {
  const onboarded = useMios((st) => !!st.settings.onboardedAt);
  const updateSettings = useMios((st) => st.updateSettings);
  const done = () => updateSettings({ onboardedAt: new Date().toISOString() });

  return (
    <Dialog
      open={!onboarded}
      onClose={done}
      title="Welcome to MiOS"
      actions={
        <Button variant="primary" onClick={done} autoFocus>
          Got it
        </Button>
      }
    >
      <p>
        MiOS runs your day like an operating system: tasks have states, you set the order, and a referee guards your
        protected time. The aim is to make you better at thinking things through yourself.
      </p>
      <p>
        AI helps most at <strong>child</strong> stage. At <strong>teen</strong> stage you answer a quick question
        before it helps. At <strong>adult</strong> stage it&apos;s gone. You move up as your own decisions get better.
      </p>
      <AiDisclosureText />
    </Dialog>
  );
}
