import Link from "next/link";
import type { Metadata } from "next";
import { CircleUserWallet } from "@/components/circle-user-wallet";

export const metadata: Metadata = {
  title: "AERIS — Your Circle wallet",
  description: "Open your own Circle wallet on Arc when email onboarding is available.",
};

export default function CircleWalletPage() {
  return (
    <main className="buildPage paymentPage">
      <header>
        <Link href="/" className="brand">
          AERIS
        </Link>
        <nav aria-label="Product pages">
          <Link href="/payments">Payments</Link>
          <b aria-current="page">Circle wallet</b>
          <Link href="/about">Evidence</Link>
        </nav>
        <span className="buildBadge">ARC MAINNET</span>
      </header>
      <section className="buildIntro">
        <small>USER-CONTROLLED WALLETS</small>
        <h1>A wallet of your own.</h1>
        <p>
          Sign in with email, open your Circle wallet and approve your own USDC
          transfers.
        </p>
      </section>
      <CircleUserWallet />
      <footer>
        <Link href="/payments">Use an existing wallet ↗</Link>
      </footer>
    </main>
  );
}
