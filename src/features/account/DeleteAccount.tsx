"use client";

import { useState } from "react";
import { authMessage } from "@/integrations/firebase/auth";
import { deleteAccount, useAccount } from "@/state/account";
import { Button, Card, Dialog } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { PasswordField } from "./PasswordField";
import s from "./account.module.css";

/** Settings: who's signed in, and the way out. Shown only when signed in. */
export function AccountCard() {
  const account = useAccount((st) => st.account);
  const [deleting, setDeleting] = useState(false);
  if (!account) return null;
  return (
    <Card title="Account" hint="Signed in, so your data also lives in your account and follows you to other devices.">
      <p className={s.lead}>
        {account.email}
        {account.provider === "google" ? " · Google" : " · email and password"}
      </p>
      <Button variant="danger" onClick={() => setDeleting(true)}>
        Delete my account
      </Button>
      {deleting && <DeleteAccountDialog onClose={() => setDeleting(false)} />}
    </Card>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const account = useAccount((st) => st.account)!;
  const toast = useToast((t) => t.show);
  const [password, setPassword] = useState("");
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const google = account.provider === "google";

  const go = async () => {
    setBusy(true);
    setError("");
    try {
      await deleteAccount(google ? undefined : password);
      toast("Your account and everything in it are deleted.");
      onClose();
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "";
      setError(
        code.startsWith("auth/")
          ? authMessage(e)
          : "Couldn't finish deleting. Check your connection and try again; your account is still there.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Delete your account?"
      actions={
        <>
          <Button variant="plain" onClick={onClose} disabled={busy}>
            Keep my account
          </Button>
          <Button variant="danger" onClick={() => void go()} disabled={busy || !sure || (!google && !password)}>
            {busy ? "Deleting…" : "Delete for good"}
          </Button>
        </>
      }
    >
      <p className={s.lead}>
        This deletes your MiOS account ({account.email}) and everything synced to it: tasks, history, stats, calendars and
        AI notes, on every device. This browser is cleared too. It can&apos;t be undone. If you want a copy, use Export
        JSON in Settings first.
      </p>
      <p className={s.lead}>
        Events MiOS added to the &ldquo;MiOS&rdquo; calendar in your Google Calendar stay there; delete that calendar in
        Google if you don&apos;t want them.
      </p>
      <div className={s.form}>
        {google ? (
          <p className={s.notice}>Google will ask you to confirm it&apos;s you.</p>
        ) : (
          <PasswordField
            label="Your password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        <label className={s.check}>
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          I understand this can&apos;t be undone
        </label>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
