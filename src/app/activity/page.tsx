import Link from "next/link";
import {MyActivity} from "@/components/my-activity";
export const metadata={title:"AERIS — My Activity",description:"Track your Arc address, inspect recorded USDC movements and verify payments without connecting a wallet."};
export default function Page(){return <main className="buildPage"><header><Link href="/" className="brand">AERIS</Link><nav><b aria-current="page">My Activity</b><Link href="/check">Check payment</Link><Link href="/payments">Send USDC</Link><Link href="/">Live</Link></nav><span className="buildBadge">ARC MAINNET</span></header><MyActivity/></main>;}
