"use client";
/**
 * How you look: one of the illustrated avatars, or a photo of your own. The
 * full picker sits in Settings → Profile; a single row of it greets a new
 * account in the welcome step. Every change shows at once, everywhere.
 */
import { useState } from "react";
import { AVATAR_PRESETS, presetOf, presetUrl, type AvatarPreset } from "@imo/core/avatars";
import { Avatar } from "@/components/ui";
import { Check, Plus, Spinner } from "@/components/icons";
import { useDemo } from "@/services/provider";
import { YOU } from "@/client/normalize";
import styles from "./avatar-picker.module.css";

const PHOTO_TYPES = "image/png,image/jpeg,image/webp,image/gif";

export function AvatarPicker({
  compact = false,
  onSaved,
}: {
  /** One scrolling row, for the welcome step. */
  compact?: boolean;
  /** Told what changed, for a toast. */
  onSaved?(message: string): void;
}) {
  const { services } = useDemo();
  const me = services.profiles.get(YOU);
  const current = presetOf(me?.avatarUrl);
  const photo = !!me?.avatarUrl && !current;
  const [busy, setBusy] = useState<null | "upload" | "remove" | AvatarPreset>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (which: NonNullable<typeof busy>, action: () => Promise<void>, done: string, failed: string) => {
    setBusy(which);
    setProblem(null);
    try {
      await action();
      onSaved?.(done);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : failed);
    } finally {
      setBusy(null);
    }
  };
  const upload = (file: File | undefined) => {
    if (file) void run("upload", () => services.settings.uploadAvatar(file), "Photo updated.", "The photo didn’t upload.");
  };
  const choose = (preset: AvatarPreset) => {
    if (busy || preset === current) return;
    void run(preset, () => services.settings.chooseAvatar(preset), "Avatar updated.", "That avatar wasn’t saved.");
  };

  const photoInput = (
    <input
      type="file"
      accept={PHOTO_TYPES}
      className="sr-only"
      disabled={!!busy}
      onChange={(e) => {
        upload(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  return (
    <div className={styles.picker} data-compact={compact || undefined}>
      {!compact && (
        <div className={styles.current}>
          {me && <Avatar trader={me} size={72} />}
          <div className={styles.actions}>
            <label className={`btn btn-secondary ${styles.upload}`} aria-disabled={!!busy || undefined}>
              {busy === "upload" ? "Uploading…" : photo ? "Change photo" : "Upload photo"}
              {photoInput}
            </label>
            {photo && (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!!busy}
                onClick={() =>
                  void run("remove", () => services.settings.removeAvatar(), "Photo removed.", "The photo wasn’t removed.")
                }
              >
                {busy === "remove" ? "Removing…" : "Remove photo"}
              </button>
            )}
          </div>
        </div>
      )}
      <span className={styles.label} id={compact ? "avatar-row-label" : "avatar-grid-label"}>
        {compact ? "Pick an avatar — or add a photo" : photo ? "Or wear an illustration" : "Pick an illustration"}
      </span>
      <div
        className={styles.options}
        role="group"
        aria-labelledby={compact ? "avatar-row-label" : "avatar-grid-label"}
      >
        {compact && (
          <label className={styles.add} aria-disabled={!!busy || undefined} title="Upload a photo">
            {busy === "upload" ? <Spinner size={16} className="spin" /> : <Plus size={16} />}
            <span className="sr-only">Upload a photo</span>
            {photoInput}
          </label>
        )}
        {AVATAR_PRESETS.map((preset, i) => {
          const on = preset.id === current;
          return (
            <button
              key={preset.id}
              type="button"
              className={styles.option}
              aria-pressed={on}
              aria-label={`Illustration ${i + 1}`}
              disabled={!!busy}
              onClick={() => choose(preset.id)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={presetUrl(preset.id)} alt="" loading="lazy" width={48} height={48} />
              {busy === preset.id ? (
                <span className={styles.badge}>
                  <Spinner size={10} className="spin" />
                </span>
              ) : (
                on && (
                  <span className={styles.badge}>
                    <Check size={10} />
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
