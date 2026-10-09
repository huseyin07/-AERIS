import Link from "next/link";
import {ReceiptChecker} from "@/components/receipt-checker";
export const metadata={title:"AERIS — Check a payment",description:"Check a USDC payment against its confirmed Arc Mainnet receipt without connecting a wallet."};
export default function Page(){return <main className="buildPage"><header><Link href="/" className="brand">AERIS</Link><nav><Link href="/activity">My Activity</Link><Link href="/payments">Send USDC</Link><Link href="/">Live</Link></nav><span className="buildBadge">ARC MAINNET</span></header><ReceiptChecker/></main>;}
