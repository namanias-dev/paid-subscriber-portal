import { NextResponse } from "next/server";
import { recoverCheckoutLead } from "@/lib/store/checkoutLeads";

export const dynamic = "force-dynamic";

/** Exchange a random token for an httpOnly lead cookie, then drop the token from the URL. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") || "";
  await recoverCheckoutLead(token);
  return NextResponse.redirect(new URL("/notes/checkout", "https://www.namanias.com"), 302);
}
