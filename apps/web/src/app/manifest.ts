import type { MetadataRoute } from "next";

/** Installing imo (Add to Home Screen): its name, colours and icon — the
    main logo, from public/brand (scripts/brand-assets.mjs). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "imo",
    short_name: "imo",
    description: "Social prediction trading: see a prediction, read the reasoning, back it.",
    start_url: "/",
    display: "standalone",
    background_color: "#090d0b",
    theme_color: "#090d0b",
    icons: [
      { src: "/brand/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/app-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
