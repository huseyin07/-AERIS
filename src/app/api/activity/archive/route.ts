import {NextRequest,NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {captureObservation} from "@/activity/archive";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function GET(request:NextRequest){
  const expected=`Bearer ${process.env.CRON_SECRET??""}`, actual=request.headers.get("authorization")??"";
  if(!process.env.CRON_SECRET||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return NextResponse.json({message:"Unauthorized"},{status:401});
  try{return NextResponse.json(await captureObservation(),{headers:{"Cache-Control":"no-store"}});}
  catch{return NextResponse.json({message:"Fresh complete Arc observation could not be archived."},{status:503});}
}
