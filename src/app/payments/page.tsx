import Link from "next/link";
import type {Metadata} from "next";
import {PaymentWorkbench} from "@/components/payment-workbench";

export const metadata: Metadata = {title: "AERIS — Circle invoice payments", description: "Prepare USDC invoices, enforce operator budgets, sign through Circle Wallets and verify settlement on Arc."};
export default function PaymentsPage() {
  return <main className="buildPage paymentPage">
    <header><Link href="/" className="brand">AERIS</Link><Link href="/">Live dashboard ↗</Link><span className="buildBadge">CIRCLE WALLETS · ARC MAINNET</span></header>
    <section className="buildIntro"><small>AGENT PAYMENTS</small><h1>Pay an invoice. Verify the settlement.</h1><p>AERIS checks due dates, approved recipients, treasury liquidity and spending limits. Circle signs the payment; Arc supplies the receipt.</p></section>
    <PaymentWorkbench/>
    <footer><b>AERIS</b><Link href="/about">Product & evidence ↗</Link></footer>
  </main>;
}
