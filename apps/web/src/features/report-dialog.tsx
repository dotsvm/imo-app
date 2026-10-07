"use client";
/* Report something to Hunch's moderators: a reason, an optional note. The
   admin queue (/api/v1/admin/reports) picks it up. */
import { useState } from "react";
import { Modal } from "@/components/ui";
import { useDemo } from "@/services/provider";
import type { ReportReason, ReportSubject } from "@imo/domain/demo/contracts";
import styles from "./report-dialog.module.css";

const REASONS: { id: ReportReason; label: string; hint: string }[] = [
  { id: "spam", label: "Spam", hint: "Ads, scams or the same thing over and over" },
  { id: "harassment", label: "Harassment", hint: "Attacks or threats aimed at someone" },
  { id: "misleading", label: "Misleading", hint: "Claims a position or a record that isn’t real" },
  { id: "impersonation", label: "Impersonation", hint: "Pretending to be someone else" },
  { id: "other", label: "Something else", hint: "Tell the moderators below" },
];

export function ReportDialog({
  open,
  onOpenChange,
  subject,
  what,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  subject: ReportSubject;
  /** "prediction", "comment"… */
  what: string;
}) {
  const { services } = useDemo();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setReason(null);
      setNote("");
      setStatus("idle");
      setError("");
    }
  };
  const send = async () => {
    if (!reason) return;
    setStatus("sending");
    setError("");
    try {
      await services.social.report(subject, reason, note.trim() || undefined);
      setStatus("sent");
    } catch (e) {
      setError((e as Error).message);
      setStatus("idle");
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={status === "sent" ? "Thanks — it’s with the moderators" : `Report this ${what}`}
      description={
        status === "sent"
          ? "They’ll look at it soon. The author isn’t told who reported it."
          : "Reports go to imo’s moderators. The author isn’t told who reported it."
      }
    >
      {status !== "sent" && (
        <>
          <fieldset className={styles.reasons}>
            <legend className="sr-only">Reason</legend>
            {REASONS.map((r) => (
              <label key={r.id} className={styles.reason}>
                <input
                  type="radio"
                  name="report-reason"
                  checked={reason === r.id}
                  onChange={() => setReason(r.id)}
                />
                <span>
                  <strong>{r.label}</strong>
                  <span>{r.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className={styles.note}>
            Anything the moderators should know? (optional)
            <textarea className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      <div className={styles.actions}>
        {status === "sent" ? (
          <button type="button" className="btn btn-primary" onClick={() => close(false)}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-destructive"
              disabled={!reason || status === "sending" || (reason === "other" && !note.trim())}
              onClick={() => void send()}
            >
              {status === "sending" ? "Sending…" : "Send report"}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
