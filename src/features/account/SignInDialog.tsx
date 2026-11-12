"use client";

import { useEffect, useState, type FormEvent } from "react";
import { aiAccessNotice } from "@/ai/access";
import {
  authMessage,
  refreshAccount,
  resendVerification,
  resetPassword,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from "@/integrations/firebase/auth";
import { accountRefreshed, useAccount } from "@/state/account";
import { Button, Dialog } from "@/ui/primitives";
import s from "./account.module.css";

type Mode = "signin" | "signup" | "reset";

const TITLE: Record<Mode, string> = {
  signin: "Sign in to MiOS",
  signup: "Create your MiOS account",
  reset: "Reset your password",
};

/**
 * Sign in, sign up, and password reset. MiOS works without an account;
 * signing in backs everything up and syncs it across devices. Mount only
 * while open, so each opening starts fresh.
 */
export function SignInDialog({ onClose, start = "signin" }: { onClose: () => void; start?: Mode }) {
  const account = useAccount((st) => st.account);
  const [mode, setMode] = useState<Mode>(start);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Signed in and verified (Google, or after the email link): nothing left to do here.
  useEffect(() => {
    if (account?.verified) onClose();
  }, [account, onClose]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(authMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Signed in with an unverified email: the next step is the link in the inbox.
  if (account && !account.verified) return <VerifyDialog onClose={onClose} />;
  if (account) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "reset") {
      void run(async () => {
        await resetPassword(email);
        setNotice(`If ${email.trim()} has an account, a reset link is on its way. Check your inbox.`);
      });
    } else if (mode === "signup") {
      void run(() => signUpWithEmail(email, password));
    } else {
      void run(() => signInWithEmail(email, password));
    }
  };

  const go = (m: Mode) => {
    setMode(m);
    setError("");
    setNotice("");
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={TITLE[mode]}
      actions={
        <Button variant="plain" onClick={onClose}>
          Not now
        </Button>
      }
    >
      <p className={s.lead}>
        {mode === "reset"
          ? "Enter your email and MiOS sends a link to choose a new password."
          : "Back up your tasks and stats, and use MiOS on every device. Everything still works without an account."}
      </p>

      {mode !== "reset" && (
        <>
          <Button className={s.google} onClick={() => void run(signInWithGoogle)} disabled={busy}>
            <span aria-hidden className={s.g}>
              G
            </span>
            Continue with Google
          </Button>
          <div className={s.or} aria-hidden>
            <span>or</span>
          </div>
        </>
      )}

      <form className={s.form} onSubmit={submit}>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== "reset" && (
          <label>
            Password
            <input
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={mode === "signup" ? 6 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {notice && <p className={s.notice}>{notice}</p>}
        <Button type="submit" variant="primary" disabled={busy}>
          {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
        </Button>
      </form>

      <p className={s.switch}>
        {mode === "signin" && (
          <>
            <button type="button" onClick={() => go("signup")}>
              Create an account
            </button>
            <button type="button" onClick={() => go("reset")}>
              Forgot password?
            </button>
          </>
        )}
        {mode === "signup" && (
          <button type="button" onClick={() => go("signin")}>
            Already have an account? Sign in
          </button>
        )}
        {mode === "reset" && (
          <button type="button" onClick={() => go("signin")}>
            Back to sign in
          </button>
        )}
      </p>

      <p className={s.fine}>
        {aiAccessNotice(true)} {aiAccessNotice(false)} Signing out removes your data from this browser; it stays in your
        account.
      </p>
    </Dialog>
  );
}

/** After signing up with email: verify, then sync starts. */
export function VerifyDialog({ onClose }: { onClose: () => void }) {
  const account = useAccount((st) => st.account);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const check = async () => {
    setBusy(true);
    setMsg("");
    try {
      const fresh = await refreshAccount();
      if (fresh?.verified) {
        accountRefreshed(fresh);
        onClose();
      } else setMsg("Not verified yet. Open the link in the email, then try again.");
    } catch (e) {
      setMsg(authMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Check your inbox"
      actions={
        <>
          <Button variant="plain" onClick={onClose}>
            Later
          </Button>
          <Button variant="primary" onClick={() => void check()} disabled={busy}>
            I&apos;ve verified
          </Button>
        </>
      }
    >
      <p className={s.lead}>
        MiOS sent a link to <strong>{account?.email}</strong>. Open it to confirm the address; syncing starts after that.
        Until then, MiOS keeps working in this browser.
      </p>
      <p className={s.switch}>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void resendVerification()
              .then(() => setMsg("Sent again. It can take a minute, and check spam."))
              .catch((e) => setMsg(authMessage(e)))
          }
        >
          Send the email again
        </button>
      </p>
      {msg && <p className={s.notice}>{msg}</p>}
    </Dialog>
  );
}
