import { Suspense } from "react";
import { Waitlist } from "./waitlist";

export default function WaitlistPage() {
  return (
    <Suspense fallback={null}>
      <Waitlist />
    </Suspense>
  );
}
