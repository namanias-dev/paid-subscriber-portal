import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    app: "aiva",
    build: process.env.NEXT_PUBLIC_BUILD_ID || "dev",
    ts: new Date().toISOString(),
  });
}
