import {NextRequest,NextResponse} from "next/server";
import {archiveConfigured,readAddressHistory} from "@/activity/archive";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
let running=0;
export async function GET(request:NextRequest){
  const q=request.nextUrl.searchParams,address=(q.get("address")??"").toLowerCase(),since=Number(q.get("since")),until=Number(q.get("until")),cursor=q.get("cursor")??undefined;
  if(!/^0x[\da-f]{40}$/.test(address)||!Number.isSafeInteger(since)||!Number.isSafeInteger(until)||since<=0||until<since||until-since>7*86400_000||until>Date.now()+30000||(cursor&&!/^arc-history\/v1\/\d{13}\.json\.gz$/.test(cursor)))return NextResponse.json({message:"Enter a full address and a range of up to seven days."},{status:400});
  if(!archiveConfigured())return NextResponse.json({message:"Persistent history is not configured. Live activity remains available."},{status:503});
  if(running>=8)return NextResponse.json({message:"History is busy. Retry shortly."},{status:503});
  running++;
  try{return NextResponse.json(await readAddressHistory(address,since,until,cursor),{headers:{"Cache-Control":"no-store"}});}
  catch{return NextResponse.json({message:"Archived history is temporarily unavailable. No empty history has been inferred."},{status:503});}
  finally{running--;}
}
