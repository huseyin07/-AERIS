import Link from "next/link";
import { CircleUserWallet } from "@/components/circle-user-wallet";
export default function CircleWalletPage() {
  return (
    <main className="buildPage paymentPage">
      <header>
        <Link href="/" className="brand">
          AERIS
        </Link>
        <nav>
          <Link href="/payments">Payments</Link>
          <b>Circle wallet</b>
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
