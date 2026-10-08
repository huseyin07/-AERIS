import Link from "next/link";
import type {Metadata} from "next";
import {PaymentWorkbench} from "@/components/payment-workbench";

export const metadata: Metadata = {title: "AERIS — Circle invoice payments", description: "Prepare USDC invoices, enforce operator budgets, sign through Circle Wallets and verify settlement on Arc."};
export default function PaymentsPage() {
  return <main className="buildPage paymentPage">
    <header><Link href="/" className="brand">AERIS</Link><nav aria-label="Product pages"><Link href="/">Live</Link><b aria-current="page">Payments</b><Link href="/about">Evidence</Link></nav><span className="buildBadge">ARC MAINNET</span></header>
    <section className="buildIntro"><small>CIRCLE INVOICE PAYMENTS</small><h1>Pay an invoice. Verify the settlement.</h1><p>Know what is due, what the treasury can afford, and whether the payment settled.</p></section>
    <PaymentWorkbench/>
    <footer><b>AERIS</b><Link href="/about">Product & evidence ↗</Link></footer>
  </main>;
}
