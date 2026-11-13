"use client";

import { useEffect, useRef, useState } from "react";
import { aiAccessNotice } from "@/ai/access";
import { firebaseConfigured } from "@/integrations/firebase/client";
import { chooseFirstSync, retrySync, startAccountWatch, useAccount } from "@/state/account";
import { formatWhen } from "@/ui/format";
import { Button, Dialog } from "@/ui/primitives";
import { FeedbackLink } from "./FeedbackLink";
import { SignInDialog, VerifyDialog } from "./SignInDialog";
import { SignOutDialog } from "./SignOutDialog";
import s from "./account.module.css";

/** Mounted once in the app shell: follows sign-in, and asks the first-sync question when needed. */
export function AccountRuntime() {
  useEffect(() => startAccountWatch(), []);
  const choice = useAccount((st) => st.choice);
  if (!choice) return null;
  return (
    <Dialog
      open
      onClose={() => chooseFirstSync(true)}
      title="This browser has tasks too"
      actions={
        <>
          <Button variant="plain" onClick={() => chooseFirstSync(false)}>
            Use only my account&apos;s
          </Button>
          <Button variant="primary" onClick={() => chooseFirstSync(true)}>
            Add them to my account
          </Button>
        </>
      }
    >
      <p>
        Your account has {choice.remoteTasks} {choice.remoteTasks === 1 ? "task" : "tasks"}, and this browser has{" "}
        {choice.localTasks} from before you signed in. Add this browser&apos;s tasks and stats to your account, or replace
        them with your account&apos;s?
      </p>
    </Dialog>
  );
}

const PHASE_TEXT = {
  off: "",
  starting: "Syncing…",
  choose: "Waiting for your choice",
  saving: "Saving…",
  synced: "Synced",
  error: "Sync stopped",
} as const;

/** The header control: "Sign in" for guests, the account menu when signed in. */
export function AccountButton() {
  const status = useAccount((st) => st.status);
  const account = useAccount((st) => st.account);
  const phase = useAccount((st) => st.phase);
  const [open, setOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!firebaseConfigured() || status === "loading") return null;

  if (!account) {
    return (
      <>
        <Button size="sm" variant="primary" onClick={() => setSigningIn(true)}>
          Sign in
        </Button>
        {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
      </>
    );
  }

  const initial = (account.name || account.email || "?").trim()[0]?.toUpperCase();
  const warn = !account.verified || phase === "error";

  return (
    <div className={s.wrap} ref={ref}>
      <button
        type="button"
        className={`${s.avatar} ${warn ? s.warn : ""}`}
        aria-label={`Account: ${account.email ?? account.name ?? "signed in"}${warn ? " (needs attention)" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {initial}
      </button>
      {open && <AccountMenu />}
    </div>
  );
}

function AccountMenu() {
  const account = useAccount((st) => st.account)!;
  const phase = useAccount((st) => st.phase);
  const message = useAccount((st) => st.message);
  const lastSyncedAt = useAccount((st) => st.lastSyncedAt);
  const [verifying, setVerifying] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className={s.menu} role="dialog" aria-label="Account">
      <div className={s.who}>
        {account.name && <strong>{account.name}</strong>}
        <span>{account.email}</span>
      </div>

      {account.verified ? (
        <p className={`${s.sync} ${phase === "error" ? s.syncError : ""}`}>
          {PHASE_TEXT[phase]}
          {phase === "synced" && lastSyncedAt ? ` · ${formatWhen(lastSyncedAt)}` : ""}
          {phase === "error" && message ? `. ${message}` : ""}
          {phase === "error" && (
            <button type="button" className={s.link} onClick={retrySync}>
              Try again
            </button>
          )}
        </p>
      ) : (
        <p className={`${s.sync} ${s.syncError}`}>
          Verify your email to start syncing.
          <button type="button" className={s.link} onClick={() => setVerifying(true)}>
            Verify
          </button>
        </p>
      )}

      <p className={s.fine}>{aiAccessNotice(true)}</p>

      <FeedbackLink className={s.fine} />

      <Button size="sm" onClick={() => setSigningOut(true)}>
        Sign out
      </Button>
      {verifying && <VerifyDialog onClose={() => setVerifying(false)} />}
      {signingOut && <SignOutDialog onClose={() => setSigningOut(false)} />}
    </div>
  );
}
