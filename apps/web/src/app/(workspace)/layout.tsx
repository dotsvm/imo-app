import Image from "next/image";
import { Suspense } from "react";
import { HunchShell } from "@/components/app-shell";
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="boot-screen" role="status">
          <Image src="/brand/wordmark.png" alt="imo" width={116} height={40} priority />
          <span>Loading…</span>
        </div>
      }
    >
      <HunchShell>{children}</HunchShell>
    </Suspense>
  );
}
