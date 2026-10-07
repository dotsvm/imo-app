"use client";
import Image from "next/image";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="boot-screen">
      <Image src="/brand/wordmark.png" alt="imo" width={104} height={36} priority />
      <h1>Let’s get your view back.</h1>
      <p>
        Something went wrong on this screen. Your account, positions and
        predictions are saved on our side.
      </p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
