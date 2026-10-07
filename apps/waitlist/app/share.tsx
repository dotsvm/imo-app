"use client";
/**
 * Share your pass (design/02-Waitlist-Pass, "Share on 𝕏"): the post in the
 * tone you pick, editable, and the card your link unfurls into. Posting
 * opens X's composer with it; the first post moves you up the line.
 * A dialog on desktop, a sheet from the bottom on phones.
 */
import * as Dialog from "@radix-ui/react-dialog";
import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SHARE_BOOST } from "@imo/core/waitlist";
import { Check, Copy, Download, X, XLogo } from "@web/components/icons";
import type { WaitlistStatus } from "./claims";
import { EDITIONS, FOUNDING_PASSES, isEdition, passNumber } from "./editions";
import { Pass } from "./pass";
import styles from "./share.module.css";

const TONES = [
  { id: "flex", label: "Flex" },
  { id: "dare", label: "Dare" },
  { id: "low", label: "Low-key" },
] as const;
type Tone = (typeof TONES)[number]["id"];

/** X counts every link as 23 characters, however long it is. */
const LINKS = /\bhttps?:\/\/\S+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/\S*/gi;
const weighed = (text: string) => text.replace(LINKS, "x".repeat(23)).length;

/** What the post says, from the pass's own numbers. No "@handle" in it: on X
    that would mention whoever holds the name there. Your link carries it. */
function draft(tone: Tone, pass: WaitlistStatus, link: string) {
  const no = passNumber(pass.pass);
  if (tone === "low") return `got my imo pass. ${no}\n${link}`;
  if (tone === "dare") {
    const left = pass.passesLeft > 0 ? ` Only ${pass.passesLeft.toLocaleString("en-US")} Founding Passes left.` : "";
    return `Bet you can’t get a better name on imo than mine.${left}\n\n${link}`;
  }
  const kind = pass.founding ? `Founding Pass ${no} of ${FOUNDING_PASSES.toLocaleString("en-US")}` : `Pass ${no}`;
  return `Claimed my name on imo. ${kind}.\n\nBack it or fade it → ${link}`;
}

export function ShareComposer({
  open,
  onOpenChange,
  status,
  link,
  posting,
  problem,
  onPost,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: WaitlistStatus;
  /** Your link as people read it: "imo.live/i/you". */
  link: string;
  posting: boolean;
  problem: string | null;
  onPost: (text: string) => void;
}) {
  const [tone, setTone] = useState<Tone>("flex");
  const [edited, setEdited] = useState<string | null>(null);
  const postButton = useRef<HTMLButtonElement>(null);
  const text = edited ?? draft(tone, status, link);
  const left = 280 - weighed(text);
  const E = EDITIONS[isEdition(status.edition) ? status.edition : "classic"];
  const host = link.split("/")[0];
  // The card as X shows it under your link, 1200 × 630, drawn by the server:
  // to attach to the post yourself, or keep.
  const card = `/i/${encodeURIComponent(status.handle)}/opengraph-image`;
  const [copy, setCopy] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  const copyCard = async () => {
    if (copy === "copying") return;
    clearTimeout(copyTimer.current);
    setCopy("copying");
    let next: "copied" | "failed" = "copied";
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("no image clipboard");
      // The item takes the image while it's still on its way, so Safari keeps
      // the click's permission while the server draws the card.
      const png = fetch(card).then((res) => {
        if (!res.ok) throw new Error(`card ${res.status}`);
        return res.blob();
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    } catch {
      next = "failed";
    }
    setCopy(next);
    copyTimer.current = setTimeout(() => setCopy("idle"), next === "copied" ? 1_800 : 4_000);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !posting && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.sheet}
          // Start on Post, not in the text: a phone's keyboard would cover the card.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            postButton.current?.focus();
          }}
        >
          <span className={styles.grabber} aria-hidden="true" />
          <div className={styles.head}>
            <Dialog.Title className={styles.title}>Share your pass</Dialog.Title>
            {!status.shared && (
              <span className={styles.bonus}>
                +{SHARE_BOOST} spots<span className={styles.wide}> when you post</span>
              </span>
            )}
            <Dialog.Close className={styles.close} aria-label="Close" disabled={posting}>
              <X size={16} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Post your pass on X, with your link for friends to claim theirs.
          </Dialog.Description>

          <div className={styles.body}>
            {/* eslint-disable-next-line @next/next/no-img-element -- presets, uploads or a provider's photo */}
            <img className={styles.avatar} src={status.avatarUrl} alt="" width={40} height={40} />
            <div className={styles.main}>
              <label className="sr-only" htmlFor="share-text">
                Post text
              </label>
              <textarea
                id="share-text"
                className={styles.text}
                rows={4}
                value={text}
                onChange={(e) => setEdited(e.target.value)}
                spellCheck
              />
              <div className={styles.preview} aria-hidden="true" style={{ "--glow": E.glow } as CSSProperties}>
                <div className={styles.card}>
                  <Image src="/brand/wordmark.png" alt="" width={37} height={18} className={styles.wordmark} />
                  <span className={styles.cardHandle}>@{status.handle}</span>
                  <span className={styles.cardKind}>
                    {status.founding ? "FOUNDING PASS" : "WAITLIST PASS"} {passNumber(status.pass)} · {E.name}
                  </span>
                  <span className={styles.cardCta}>Claim yours → {host}</span>
                </div>
                <div className={styles.cardPass}>
                  <Pass
                    width={150}
                    handle={status.handle}
                    number={status.pass}
                    founding={status.founding}
                    edition={isEdition(status.edition) ? status.edition : "classic"}
                    issuedAt={status.issuedAt}
                  />
                </div>
              </div>
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.cardAction}
                  data-state={copy}
                  aria-busy={copy === "copying" || undefined}
                  onClick={() => void copyCard()}
                >
                  {copy === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                  {copy === "copying" ? "Copying…" : copy === "copied" ? "Copied" : "Copy image"}
                </button>
                <a className={styles.cardAction} href={card} download={`imo-pass-${status.handle}.png`}>
                  <Download size={14} aria-hidden="true" />
                  Download
                </a>
              </div>
              <p className={styles.cardNote} role="status">
                {copy === "copied"
                  ? "The card is on your clipboard: paste it into your post."
                  : copy === "failed"
                    ? "This browser won’t copy images. Download it instead."
                    : ""}
              </p>
            </div>
          </div>

          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <div className={styles.foot}>
            <div className={styles.tones} role="radiogroup" aria-label="Tone">
              {TONES.map((t) => (
                <label key={t.id} className={styles.tone}>
                  <input
                    type="radio"
                    name="share-tone"
                    value={t.id}
                    checked={tone === t.id}
                    onChange={() => {
                      setTone(t.id);
                      setEdited(null);
                    }}
                  />
                  {t.label}
                </label>
              ))}
            </div>
            <span className={styles.count} data-tone={left < 0 ? "bad" : left < 20 ? "gold" : undefined}>
              {left}
              <span className="sr-only"> characters left</span>
            </span>
            <Dialog.Close className={styles.later} disabled={posting}>
              Not now
            </Dialog.Close>
            <button
              ref={postButton}
              type="button"
              className={styles.post}
              data-posting={posting || undefined}
              disabled={left < 0 || posting || !text.trim()}
              aria-label={posting ? "Posting to X" : "Post to X"}
              onClick={() => onPost(text)}
            >
              {posting && <span className={styles.spinner} aria-hidden="true" />}
              {posting ? "Posting…" : "Post to"}
              <XLogo size={14} aria-hidden="true" />
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
