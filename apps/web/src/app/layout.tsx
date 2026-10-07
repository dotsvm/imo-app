import type { Metadata } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import "./globals.css";
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
  display: "swap",
});
const description =
  "Social prediction trading: see a prediction, read the reasoning, back it. Paper trading with simulated funds.";
export const metadata: Metadata = {
  // Absolute links for the icons and link previews (app/icon.png,
  // app/opengraph-image.png…, derived from public/brand by scripts/brand-assets.mjs).
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: "imo — See a prediction. Read the reasoning. Back it.",
  description,
  applicationName: "imo",
  openGraph: { type: "website", siteName: "imo", title: "imo", description },
  twitter: { card: "summary_large_image", title: "imo", description },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geist.variable} ${instrumentSerif.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
