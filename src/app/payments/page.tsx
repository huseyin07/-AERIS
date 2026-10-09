import Link from "next/link";
import type {Metadata} from "next";
import {PublicTransfers} from "@/components/public-transfers";

export const metadata: Metadata = {title: "AERIS — Send USDC on Arc", description: "Connect your wallet, review a USDC transfer and verify its settlement on Arc Mainnet."};
export default function PaymentsPage() {
  return <main className="buildPage paymentPage">
    <header><Link href="/" className="brand">AERIS</Link><nav aria-label="Product pages"><Link href="/">Live</Link><b aria-current="page">Payments</b><Link href="/about">About</Link></nav><span className="buildBadge">ARC MAINNET</span></header>
    <section className="buildIntro"><small>USDC TRANSFERS</small><h1>Your wallet. Your transfer.</h1><p>Send USDC on Arc. Review the amount and network fee, approve in your wallet, then check the receipt.</p></section>
    <PublicTransfers/>
    <footer><b>AERIS</b><Link href="/payments/operator">Circle operator tools ↗</Link><Link href="/about">Product & evidence ↗</Link></footer>
  </main>;
}
