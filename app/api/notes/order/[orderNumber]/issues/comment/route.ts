import { NextResponse } from "next/server";
import { verifyRawTokenAgainstHash } from "@/lib/store/accessToken";
import { storeDb } from "@/lib/store/db";
import { clampIssueText, issueIsOpen, toPublicIssue } from "@/lib/store/issues";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** One follow-up on the open issue. Does not open a second ticket. */
export async function POST(req: Request, { params }: { params: { orderNumber: string } }) {
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: noStore });
  const body = (await req.json().catch(() => null)) as { t?: string; reference?: string; comment?: string } | null;
  const token = String(body?.t || "").trim();
  const reference = String(body?.reference || "").trim().toUpperCase();
  const comment = clampIssueText(String(body?.comment || ""));
  if (comment.length < 8) {
    return NextResponse.json({ ok: false, error: "Add a short note." }, { status: 400, headers: noStore });
  }
  const orderNo = decodeURIComponent(params.orderNumber || "").trim().toUpperCase();
  const { data: order } = await db
    .from("store_orders")
    .select("id,order_no,tracking_token_hash")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (!order || !verifyRawTokenAgainstHash(token, order.tracking_token_hash)) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404, headers: noStore });
  }
  const { data: issue } = await db
    .from("store_order_issues")
    .select("id,reference,category,description,status,created_at,updated_at,customer_note,callback_requested,order_id")
    .eq("order_id", order.id)
    .eq("reference", reference)
    .maybeSingle();
  if (!issue || !issueIsOpen(issue.status)) {
    return NextResponse.json({ ok: false, error: "That issue is no longer open." }, { status: 409, headers: noStore });
  }
  const now = new Date().toISOString();
  const note = `You added: ${comment}`;
  const { error } = await db
    .from("store_order_issues")
    .update({ customer_note: note, updated_at: now })
    .eq("id", issue.id);
  if (error) return NextResponse.json({ ok: false, error: "Could not save that note." }, { status: 400, headers: noStore });
  await db.from("store_order_issue_events").insert({
    issue_id: issue.id,
    order_id: order.id,
    event: "customer_comment",
    from_status: issue.status,
    to_status: issue.status,
    actor_type: "customer",
    body: comment,
    visibility: "customer",
    created_at: now,
  });
  return NextResponse.json(
    { ok: true, issue: toPublicIssue({ ...issue, customer_note: note, updated_at: now }) },
    { headers: noStore },
  );
}
