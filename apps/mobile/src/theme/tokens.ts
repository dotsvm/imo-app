/**
 * imo's tokens, mirrored from the web app's src/app/globals.css (the shipped
 * source of truth). Change a value there first, then here.
 */
export const color = {
  bg: "#090d0b",
  surface: "#121519",
  neutral100: "#0e1114",
  neutral200: "#171a1f",
  neutral300: "#1e2129",
  neutral400: "#252832",
  neutral500: "#363a44",
  /** Glyphs, rules, large figures. */
  neutral600: "#7b808b",
  /** Muted text: clears AA on every surface. */
  neutral700: "#969ca6",
  neutral800: "#c3c7cd",
  text: "#eeefea",
  divider: "#1c1f25",
  // Money is the color: positive = Yes · gain, coral = No · loss · destructive.
  pos: "#b5e6a1",
  pos100: "rgba(181, 230, 161, 0.07)",
  pos200: "rgba(181, 230, 161, 0.14)",
  posLine: "rgba(181, 230, 161, 0.35)",
  onPos: "#183127",
  neg: "#e4998c",
  neg200: "rgba(228, 153, 140, 0.14)",
  negLine: "rgba(228, 153, 140, 0.35)",
  gold: "#e2c892",
  gold200: "rgba(226, 200, 146, 0.14)",
  scrim: "rgba(5, 8, 6, 0.45)",
} as const;

/** 6 chips · 8 controls · 12 cards · 16 sheets; every button is a pill or a circle. */
export const radius = {
  chip: 6,
  control: 8,
  field: 10,
  card: 12,
  panel: 14,
  sheet: 16,
  drawer: 20,
  pill: 999,
} as const;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const;

/** Geist for UI and figures, Instrument Serif for display. Names match the loaded fonts. */
export const font = {
  regular: "Geist_400Regular",
  medium: "Geist_500Medium",
  semibold: "Geist_600SemiBold",
  display: "InstrumentSerif_400Regular",
  displayItalic: "InstrumentSerif_400Regular_Italic",
} as const;

export const text = {
  display: 56,
  h1: 32,
  h2: 24,
  price: 44,
  /** Posts read a step larger on a phone than the web's 14px body. */
  post: 15,
  body: 14,
  ui: 13,
  label: 11,
} as const;

/** Quick and subtle: 120–280ms, ease-out, small moves. */
export const motion = { fast: 120, base: 180, slow: 280 } as const;
