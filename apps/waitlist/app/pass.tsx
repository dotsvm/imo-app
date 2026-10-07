/**
 * The founding pass: a card with thickness, printed with a handle, its
 * number and edition. On the page it draws at 190px on phones and 280px from
 * tablets up, floating and leaning toward the pointer; with `width` it's a
 * still miniature at any size, for previews.
 */
import Image from "next/image";
import { forwardRef, type CSSProperties } from "react";
import { EDITIONS, passNumber, type Edition } from "./editions";
import styles from "./pass.module.css";

const LAYERS = Array.from({ length: 10 }, (_, i) => i + 1);

const issued = (at: string | null | undefined) => {
  const d = at ? new Date(at) : new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

export interface PassProps {
  /** Without the @. */
  handle: string;
  /** The pass number, once it's yours. */
  number?: number | null;
  founding: boolean;
  edition: Edition;
  issuedAt?: string | null;
  /** A print head runs over the face while the pass is being issued. */
  printing?: boolean;
  /** A still miniature this many pixels wide, hidden from screen readers. */
  width?: number;
}

export const Pass = forwardRef<HTMLDivElement, PassProps>(function Pass(
  { handle, number, founding, edition, issuedAt, printing, width },
  ref,
) {
  const E = EDITIONS[edition];
  const length = handle.length + 1;
  const kind = founding ? "FOUNDING PASS" : "WAITLIST PASS";
  const card = (
    <div className={styles.box}>
      <div className={styles.float}>
        <div
          ref={ref}
          className={styles.pass}
          data-printing={printing || undefined}
          style={
            {
              "--face": E.face,
              "--edge": E.edge,
              "--ink": E.ink,
              "--line": E.line,
              "--handle-lg": `${length > 11 ? Math.max(24, 480 / length) : 44}px`,
              "--handle-sm": `${length > 11 ? Math.max(16, 320 / length) : 30}px`,
            } as CSSProperties
          }
        >
          {LAYERS.map((i) => (
            <span key={i} className={styles.layer} style={{ "--i": i } as CSSProperties} />
          ))}
          <div
            className={styles.face}
            role={width ? undefined : "img"}
            aria-label={
              width
                ? undefined
                : `${founding ? "Founding" : "Waitlist"} pass for @${handle}, ${E.label} edition${number ? `, number ${number}` : ""}`
            }
          >
            <div className={styles.top} aria-hidden="true">
              <span className={styles.brand}>
                <Image src="/brand/mark.png" alt="" width={24} height={24} data-light={E.light || undefined} />
                imo
              </span>
              <span className={styles.tag}>{kind}</span>
            </div>
            <div className={styles.holder} aria-hidden="true">
              <span className={styles.micro}>HOLDER</span>
              <span className={styles.handle}>@{handle}</span>
            </div>
            <div className={styles.meta} aria-hidden="true">
              <span>
                <span className={styles.micro}>NO.</span>
                <span key={number ?? 0} className={number ? styles.inked : undefined}>
                  {passNumber(number)}
                </span>
              </span>
              <span>
                <span className={styles.micro}>EDITION</span>
                {E.name}
              </span>
              <span>
                <span className={styles.micro}>ISSUED</span>
                {issued(issuedAt)}
              </span>
            </div>
            <div className={styles.code} aria-hidden="true">
              <span className={styles.barcode} />
              <span>IMO.LIVE</span>
            </div>
            <span className={styles.scan} aria-hidden="true" />
            <span className={styles.glare} aria-hidden="true" />
            <span className={styles.grain} aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
  if (!width) return card;
  return (
    <div
      className={styles.mini}
      style={{ width, height: (width * 416) / 280, "--scale": width / 280 } as CSSProperties}
      aria-hidden="true"
    >
      {card}
    </div>
  );
});
