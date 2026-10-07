import type { Metadata } from "next";
import { Suspense } from "react";
import { passNumber } from "../../editions";
import { Waitlist } from "../../waitlist";
import { holderOf } from "./holder";

type Props = { params: Promise<{ handle: string }> };

// A holder's pass can change (a new edition, a new name): read it each time.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const holder = await holderOf((await params).handle);
  if (!holder) return {};
  const title = `@${holder.handle} is on the record — imo`;
  const description = `${holder.founding ? "Founding pass" : "Pass"} ${passNumber(holder.pass)}. Claim your username on imo before the beta opens.`;
  // Each block replaces the layout's whole, so it restates the large card.
  return {
    title,
    description,
    openGraph: { type: "website", siteName: "imo", title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** Someone's link: the waitlist, with whose link it was. An unknown name
    is just the waitlist. */
export default async function HolderLink({ params }: Props) {
  const holder = await holderOf((await params).handle);
  return (
    <Suspense fallback={null}>
      <Waitlist referrer={holder?.handle ?? null} />
    </Suspense>
  );
}
