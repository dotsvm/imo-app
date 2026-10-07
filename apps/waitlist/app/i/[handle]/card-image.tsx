/**
 * A holder's link preview (design/02-Waitlist-Pass, "Link preview image"):
 * 1200 × 630, what followers see on X — the handle, its pass number and
 * edition, and the pass itself. Drawn by Satori, which knows flexbox and flat
 * transforms only, so the pass leans in two dimensions with its edge showing.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { FOUNDING_PASSES } from "@imo/core/waitlist";
import { EDITIONS, isEdition, passNumber } from "../../editions";
import { holderOf, waitlistHost } from "./holder";

export const CARD_SIZE = { width: 1200, height: 630 };

type Face = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: "normal" | "italic" };

/** One Google Fonts family as TTF faces (what Google serves a server). */
async function family(query: string): Promise<Face[]> {
  const signal = AbortSignal.timeout(4_000);
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${query}`, { signal })).text();
  const faces: Face[] = [];
  for (const [, block] of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const name = block.match(/font-family:\s*'([^']+)'/)?.[1];
    const url = block.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
    if (!name || !url) continue;
    const file = await fetch(url, { signal });
    if (!file.ok) continue;
    faces.push({
      name,
      data: await file.arrayBuffer(),
      weight: Number(block.match(/font-weight:\s*(\d+)/)?.[1] ?? 400) as Face["weight"],
      style: /font-style:\s*italic/.test(block) ? "italic" : "normal",
    });
  }
  return faces;
}

/** Fonts are fetched once per server and kept. A family that doesn't arrive
    is asked for again next time; the card draws with whatever did. */
let fonts: Promise<Face[]> | null = null;
const loadFonts = () =>
  (fonts ??= Promise.allSettled([
    family("Instrument+Serif:ital@1"),
    family("Geist:wght@500;600"),
    family("Geist+Mono:wght@400;500"),
  ]).then((all) => {
    if (all.some((one) => one.status === "rejected")) fonts = null;
    return all.flatMap((one) => (one.status === "fulfilled" ? one.value : []));
  }));

/** One of the waitlist's brand images, wherever the server was started
    from (the repository root, or the app's own folder). */
async function brand(file: string) {
  for (const dir of [join(process.cwd(), "apps/waitlist/public/brand"), join(process.cwd(), "public/brand")]) {
    try {
      return (await readFile(join(dir, file))).toString("base64");
    } catch {
      // Not here; try the next place.
    }
  }
  return null;
}
const png = (data: string | null) => (data ? `data:image/png;base64,${data}` : null);
/** The brand images, read once. The mark comes twice: as drawn, and as a
    dark silhouette for the light editions. */
let art: Promise<Record<"wordmark" | "mark" | "markDark" | "grain", string | null>> | null = null;
const loadArt = () =>
  (art ??= Promise.all([brand("wordmark.png"), brand("mark.png"), brand("grain.png")]).then(
    ([wordmark, mark, grain]) => ({
      wordmark: png(wordmark),
      mark: png(mark),
      markDark: mark
        ? `data:image/svg+xml;base64,${Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="256" height="256"><filter id="ink"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter><image width="256" height="256" filter="url(#ink)" xlink:href="data:image/png;base64,${mark}"/></svg>`,
          ).toString("base64")}`
        : null,
      grain: png(grain),
    }),
  ));

/** The pass's barcode: the face's stripe pattern, as bars. */
const BARS = Array.from({ length: 14 }, () => [2, 2, 1, 3, 3, 2]).flat();

export async function cardImage(param: string) {
  const [holder, faces, img] = await Promise.all([holderOf(param), loadFonts(), loadArt()]);
  const E = EDITIONS[holder && isEdition(holder.edition) ? holder.edition : "classic"];
  const handle = holder?.handle ?? "yourname";
  const length = handle.length + 1;
  const big = length > 10 ? Math.max(56, 900 / length) : 96;
  const onPass = (length > 11 ? Math.max(24, 480 / length) : 44) * 1.18;
  const kind = !holder || holder.founding ? "FOUNDING PASS" : "WAITLIST PASS";
  const no = passNumber(holder?.pass);
  const issued = new Date();
  const mono = { fontFamily: "Geist Mono" };
  const micro = { ...mono, fontSize: 10.6, letterSpacing: "0.08em", opacity: 0.7 };

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "#090b0a",
          color: "#eeefea",
          fontFamily: "Geist",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            backgroundImage: `radial-gradient(circle at 72% 50%, ${E.glow} 0%, rgba(0,0,0,0) 46%)`,
          }}
        />
        {img.grain && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 1200,
              height: 630,
              backgroundImage: `url(${img.grain})`,
              backgroundSize: "256px 256px",
              backgroundRepeat: "repeat",
              opacity: 0.45,
            }}
          />
        )}

        <div
          style={{
            position: "absolute",
            top: 64,
            bottom: 64,
            left: 72,
            width: 560,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {img.wordmark ? (
            // eslint-disable-next-line @next/next/no-img-element -- Satori draws plain images
            <img src={img.wordmark} width={74} height={36} alt="" />
          ) : (
            <div style={{ display: "flex", fontSize: 34, fontWeight: 600, letterSpacing: "-0.03em" }}>imo</div>
          )}
          <div style={{ ...mono, marginTop: "auto", display: "flex", fontSize: 16, letterSpacing: "0.06em", color: "#a7afab" }}>
            {holder ? `${kind} ${no} · ${E.name}` : `${FOUNDING_PASSES.toLocaleString("en-US")} FOUNDING PASSES`}
          </div>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              maxWidth: 560,
              overflow: "hidden",
              paddingBottom: 8,
              fontFamily: "Instrument Serif",
              fontStyle: "italic",
              fontSize: holder ? big : 96,
              lineHeight: 1.05,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            {holder ? `@${handle}` : "Your name,"}
          </div>
          <div style={{ marginTop: 6, display: "flex", fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em" }}>
            {holder ? "is on the record." : "on the record."}
          </div>
          <div
            style={{
              marginTop: 36,
              height: 52,
              alignSelf: "flex-start",
              display: "flex",
              alignItems: "center",
              padding: "0 22px",
              borderRadius: 999,
              background: "#b5e6a1",
              color: "#0d1f12",
              fontSize: 20,
              fontWeight: 500,
            }}
          >
            {`Claim yours · ${waitlistHost()}`}
          </div>
        </div>

        {/* The pass: its edge behind, leaning back. */}
        <div style={{ position: "absolute", top: 68, right: 120, width: 342, height: 500, display: "flex", transform: "rotate(-5deg)" }}>
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 12,
              width: 330,
              height: 490,
              borderRadius: 26,
              background: E.edge,
              boxShadow: "0 40px 80px rgba(0,0,0,0.55)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 330,
              height: 490,
              display: "flex",
              flexDirection: "column",
              padding: 24,
              borderRadius: 26,
              backgroundImage: E.face,
              border: "1px solid rgba(255,255,255,0.14)",
              color: E.ink,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: 330,
                height: 490,
                backgroundImage: "linear-gradient(150deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 42%)",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em" }}>
                {img.mark && (
                  // eslint-disable-next-line @next/next/no-img-element -- Satori draws plain images
                  <img src={(E.light ? img.markDark : img.mark) ?? img.mark} width={28} height={28} alt="" />
                )}
                imo
              </div>
              <div
                style={{
                  ...mono,
                  height: 26,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 11px",
                  borderRadius: 999,
                  border: `1px solid ${E.line}`,
                  fontSize: 10.6,
                  letterSpacing: "0.08em",
                }}
              >
                {kind}
              </div>
            </div>
            <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ ...micro, display: "flex" }}>HOLDER</div>
              <div
                style={{
                  display: "flex",
                  overflow: "hidden",
                  paddingBottom: 5,
                  fontFamily: "Instrument Serif",
                  fontStyle: "italic",
                  fontSize: onPass,
                  lineHeight: 1.15,
                  whiteSpace: "nowrap",
                }}
              >
                @{handle}
              </div>
            </div>
            <div
              style={{
                ...mono,
                marginTop: 14,
                paddingTop: 12,
                display: "flex",
                borderTop: `1px solid ${E.line}`,
                fontSize: 14,
                letterSpacing: "0.06em",
              }}
            >
              {[
                ["NO.", no],
                ["EDITION", E.name],
                ["ISSUED", `${String(issued.getMonth() + 1).padStart(2, "0")}/${issued.getFullYear()}`],
              ].map(([label, value]) => (
                <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ ...micro, display: "flex", opacity: 0.6 }}>{label}</div>
                  <div style={{ display: "flex" }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14 }}>
              <div style={{ flex: 1, height: 35, display: "flex", overflow: "hidden", opacity: 0.75 }}>
                {BARS.map((w, i) => (
                  <div
                    key={i}
                    style={{ width: w * 1.2, height: 35, flex: "none", background: i % 2 ? "transparent" : E.ink }}
                  />
                ))}
              </div>
              <div style={{ ...micro, display: "flex" }}>IMO.LIVE</div>
            </div>
          </div>
        </div>
      </div>
    ),
    // No fonts at all: leave the option out, so the built-in face draws it
    // (an empty list would leave the renderer with none).
    { ...CARD_SIZE, ...(faces.length ? { fonts: faces } : {}) },
  );
}
