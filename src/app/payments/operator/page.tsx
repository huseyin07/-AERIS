import Link from "next/link";
import type {Metadata} from "next";
import {PaymentWorkbench} from "@/components/payment-workbench";

export const metadata: Metadata = {title: "AERIS — Circle invoice payments", description: "Prepare USDC invoices, enforce operator budgets, sign through Circle Wallets and verify settlement on Arc."};
export default function PaymentsPage() {
  return <main className="buildPage paymentPage">
    <header><Link href="/" className="brand">AERIS</Link><nav aria-label="Product pages"><Link href="/">Live</Link><Link href="/payments">Payments</Link><b aria-current="page">Operator tools</b><Link href="/about">About</Link></nav><span className="buildBadge">ARC MAINNET</span></header>
    <section className="buildIntro"><small>CIRCLE OPERATOR TOOLS</small><h1>Prepare a treasury payment.</h1><p>For the operator of the configured Circle wallet. Visitors can <Link href="/payments">send from their own wallet</Link>.</p></section>
    <PaymentWorkbench/>
    <footer><b>AERIS</b><Link href="/about">Product & evidence ↗</Link></footer>
  </main>;
}
