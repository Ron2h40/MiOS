"use client";

import { useEffect, useState } from "react";
import { authMessage, signOutAccount } from "@/integrations/firebase/auth";
import { checkBeforeSignOut, forgetLocalData, type SignOutRisk } from "@/state/account";
import { exportSnapshot } from "@/state/store";
import { Button, Dialog } from "@/ui/primitives";
import { useToast } from "@/ui/toast";
import { VerifyDialog } from "./SignInDialog";
import s from "./account.module.css";

/** A JSON copy of everything in this browser, same as Settings → Export JSON. */
const downloadCopy = () => {
  const blob = new Blob([exportSnapshot()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mios-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

/**
 * Signing out clears this browser. First MiOS saves what's waiting and checks
 * nothing would be lost. If something would, it stops and says so; signing
 * out anyway takes a deliberate tick and a red button.
 */
export function SignOutDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast((t) => t.show);
  const [risk, setRisk] = useState<SignOutRisk | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void checkBeforeSignOut().then((r) => live && setRisk(r));
    return () => {
      live = false;
    };
  }, [attempt]);

  const signOut = async () => {
    setBusy(true);
    forgetLocalData();
    try {
      await signOutAccount();
      toast("Signed out. This browser is empty again.");
    } catch (e) {
      toast(authMessage(e), "warn");
    }
    onClose();
  };

  const retry = () => {
    setRisk(null);
    setSure(false);
    setAttempt((n) => n + 1);
  };

  if (verifying) {
    return (
      <VerifyDialog
        onClose={() => {
          setVerifying(false);
          retry();
        }}
      />
    );
  }

  if (!risk) {
    return (
      <Dialog open onClose={onClose} title="Signing out…" actions={<Button variant="plain" onClick={onClose}>Cancel</Button>}>
        <p className={s.lead}>Saving your latest changes to your account first.</p>
      </Dialog>
    );
  }

  if (risk.kind === "safe") {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Sign out?"
        actions={
          <>
            <Button variant="plain" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void signOut()}>
              Sign out
            </Button>
          </>
        }
      >
        <p className={s.lead}>Everything is saved in your account. Signing out removes it from this browser; sign in again to get it back.</p>
      </Dialog>
    );
  }

  const unverified = risk.kind === "unverified";
  return (
    <Dialog
      open
      onClose={onClose}
      title={unverified ? "Your data isn't in your account yet" : "Some changes aren't saved to your account"}
      actions={
        <>
          <Button variant="plain" onClick={onClose}>
            Stay signed in
          </Button>
          <Button variant="danger" disabled={!sure || busy} onClick={() => void signOut()}>
            Sign out and lose it
          </Button>
        </>
      }
    >
      {unverified ? (
        <p className={s.lead}>
          Your email isn&apos;t verified, so nothing in this browser has been copied to your account
          {risk.tasks ? ` (${risk.tasks} ${risk.tasks === 1 ? "task" : "tasks"} and everything else)` : ""}. Signing out
          now deletes it from this browser for good. Verify your email first, and it syncs to your account.
        </p>
      ) : (
        <p className={s.lead}>
          {risk.items} {risk.items === 1 ? "change hasn't" : "changes haven't"} reached your account yet.
          {risk.reason ? ` ${risk.reason}` : ""} Signing out now loses {risk.items === 1 ? "it" : "them"} for good. Stay
          signed in and try again when you&apos;re online.
        </p>
      )}
      <div className={s.row}>
        {unverified ? (
          <Button size="sm" variant="primary" onClick={() => setVerifying(true)}>
            Verify my email
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={retry}>
            Try saving again
          </Button>
        )}
        <Button size="sm" onClick={downloadCopy}>
          Download a copy
        </Button>
      </div>
      <label className={`${s.check} ${s.risk}`}>
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
        I understand this data will be deleted and can&apos;t be recovered
      </label>
    </Dialog>
  );
}
