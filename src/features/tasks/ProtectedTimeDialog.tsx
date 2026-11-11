"use client";

import type { ProtectedConflict } from "@/core";
import { formatTime } from "@/ui/format";
import { Button, Dialog } from "@/ui/primitives";

/** A6: the referee asks before anything lands in protected or busy calendar time. */
export function ProtectedTimeDialog({
  conflicts,
  onApprove,
  onCancel,
}: {
  conflicts: ProtectedConflict[];
  onApprove: () => void;
  onCancel: () => void;
}) {
  const first = conflicts[0];
  const busy = first?.kind === "calendar";
  return (
    <Dialog
      open={conflicts.length > 0}
      onClose={onCancel}
      title={busy ? "That's busy time" : "That's protected time"}
      actions={
        <>
          <Button variant="plain" onClick={onCancel}>
            Pick another time
          </Button>
          <Button variant="danger" onClick={onApprove}>
            Schedule anyway
          </Button>
        </>
      }
    >
      {first && (
        <p>
          This slot overlaps <strong>{first.label}</strong> ({formatTime(first.start.toISOString())}–
          {formatTime(first.end.toISOString())}){busy ? ", which is on your calendar" : ""}. The referee keeps this time
          free unless you approve it.
        </p>
      )}
    </Dialog>
  );
}
