import Image from "next/image";
import Link from "next/link";
export default function NotFound() {
  return (
    <main className="boot-screen">
      <Image src="/brand/wordmark.png" alt="imo" width={104} height={36} priority />
      <h1>There’s another way forward.</h1>
      <Link className="button primary" href="/">
        Back to Discover
      </Link>
    </main>
  );
}
