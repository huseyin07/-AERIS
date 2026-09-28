import type {Metadata} from "next";
import {SpeedInsights} from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {title: "AERIS — Watch money move.", description: "A cinematic, real-time view of the Arc economy.", openGraph: {title: "AERIS — Watch money move.", description: "Real Arc USDC activity, visualized.", type: "website"}};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return <html lang="en"><body>{children}<SpeedInsights/></body></html>;
}
