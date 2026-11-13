/**
 * Where people report problems: a Google Form (free). Set its address in
 * NEXT_PUBLIC_FEEDBACK_URL; without it, no link is shown.
 */
export const FEEDBACK_URL = process.env.NEXT_PUBLIC_FEEDBACK_URL ?? "";

export function FeedbackLink({ className, label = "Report a problem or share feedback" }: { className?: string; label?: string }) {
  if (!/^https:\/\//.test(FEEDBACK_URL)) return null;
  return (
    <a className={className} href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}
