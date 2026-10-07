/**
 * The founding pass's four editions — the colour its holder carries. Shared
 * by the page, the pass and its link preview image.
 */
import { FOUNDING_PASSES, type PassEdition } from "@imo/core/waitlist";

export { FOUNDING_PASSES };

export const EDITIONS = {
  classic: {
    label: "Classic",
    name: "CLASSIC",
    face: "linear-gradient(155deg,#3a413c 0%,#1a1f1c 48%,#0d110f 100%)",
    edge: "#070908",
    ink: "#eeefea",
    line: "rgba(238,239,234,.28)",
    glow: "rgba(181,230,161,.13)",
    light: false,
  },
  macro: {
    label: "Macro",
    name: "MACRO",
    face: "linear-gradient(155deg,#d6f4c8 0%,#a6dc95 50%,#6fae63 100%)",
    edge: "#4c7d43",
    ink: "#0d1f12",
    line: "rgba(13,31,18,.3)",
    glow: "rgba(181,230,161,.24)",
    light: true,
  },
  crypto: {
    label: "Crypto",
    name: "CRYPTO",
    face: "linear-gradient(155deg,#3d7c75 0%,#1d4a45 50%,#0e2422 100%)",
    edge: "#081614",
    ink: "#e6f4ef",
    line: "rgba(230,244,239,.3)",
    glow: "rgba(110,200,185,.2)",
    light: false,
  },
  politics: {
    label: "Politics",
    name: "POLITIC",
    face: "linear-gradient(155deg,#f2b9ab 0%,#d98a79 50%,#a7584a 100%)",
    edge: "#6e342a",
    ink: "#2a0f0a",
    line: "rgba(42,15,10,.3)",
    glow: "rgba(228,153,140,.2)",
    light: true,
  },
} as const satisfies Record<PassEdition, unknown>;

export type Edition = PassEdition;
export const EDITION_KEYS = Object.keys(EDITIONS) as Edition[];
export const isEdition = (value: unknown): value is Edition =>
  typeof value === "string" && value in EDITIONS;

/** "#129": a pass number as the pass prints it; "#—" before it's yours. */
export const passNumber = (n: number | null | undefined) => (n ? `#${n.toLocaleString("en-US")}` : "#—");
