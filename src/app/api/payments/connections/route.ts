import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET() {
  const id = process.env.WALLETCONNECT_PROJECT_ID;
  return NextResponse.json(
    {
      walletConnect: !!id && /^[a-f\d]{32}$/i.test(id),
      projectId: id && /^[a-f\d]{32}$/i.test(id) ? id : null,
      circle:
        !!process.env.CIRCLE_USER_APP_ID &&
        process.env.CIRCLE_USER_EMAIL_READY === "true" &&
        /^[a-f\d]{64}$/i.test(process.env.CIRCLE_USER_SESSION_KEY ?? "") &&
        !!process.env.CIRCLE_API_KEY?.startsWith("LIVE_API_KEY:"),
      circleAppId: process.env.CIRCLE_USER_APP_ID ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
