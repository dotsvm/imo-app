import { CARD_SIZE, cardImage } from "./card-image";

// The same card on X: without its own, the waitlist's generic image wins.
export const alt = "A founding pass on imo, with the holder’s username";
export const size = CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  return cardImage((await params).handle);
}
