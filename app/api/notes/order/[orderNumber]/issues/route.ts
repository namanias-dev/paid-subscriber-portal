import { NextResponse } from "next/server";
import { verifyRawTokenAgainstHash } from "@/lib/store/accessToken";
import { storeDb } from "@/lib/store/db";
import {
  categoriesForStage,
  clampIssueText,
  issueCategoryAllowed,
  issueIsOpen,
  mintIssueReference,
  toPublicIssue,
} from "@/lib/store/issues";
import { projectCustomerStage } from "@/lib/store/projection";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

async function authorizedOrder(orderNo: string, token: string) {
  const db = storeDb();
  if (!db) return { db: null, order: null };
  const { data: order } = await db
    .from("store_orders")
    .select("id,order_no,status,tracking_token_hash")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (!order || !verifyRawTokenAgainstHash(token, order.tracking_token_hash)) return { db, order: null };
  return { db, order };
}

export async function GET(req: Request, { params }: { params: { orderNumber: string } }) {
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: noStore });
  const token = new URL(req.url).searchParams.get("t") || "";
  const orderNo = decodeURIComponent(params.orderNumber || "").trim().toUpperCase();
  const auth = await authorizedOrder(orderNo, token);
  if (!auth.order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404, headers: noStore });
  const { data, error } = await db
    .from("store_order_issues")
    .select("reference,category,description,status,created_at,updated_at,customer_note,callback_requested")
    .eq("order_id", auth.order.id)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) return NextResponse.json({ ok: true, issues: [] }, { headers: noStore });
  return NextResponse.json({ ok: true, issues: (data || []).map((row) => toPublicIssue(row)) }, { headers: noStore });
}

export async function POST(req: Request, { params }: { params: { orderNumber: string } }) {
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: noStore });
  const body = (await req.json().catch(() => null)) as {
    t?: string;
    category?: string;
    description?: string;
    callback_requested?: boolean;
  } | null;
  const token = String(body?.t || "").trim();
  const category = String(body?.category || "").trim();
  const description = clampIssueText(String(body?.description || ""));
  if (!issueCategoryAllowed(category)) {
    return NextResponse.json({ ok: false, error: "Choose what went wrong." }, { status: 400, headers: noStore });
  }
  if (description.length < 12) {
    return NextResponse.json({ ok: false, error: "Tell us a little more, in a sentence." }, { status: 400, headers: noStore });
  }
  const orderNo = decodeURIComponent(params.orderNumber || "").trim().toUpperCase();
  const auth = await authorizedOrder(orderNo, token);
  if (!auth.order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404, headers: noStore });

  const stage = projectCustomerStage(auth.order.status, true);
  if (!categoriesForStage(stage).includes(category)) {
    return NextResponse.json({ ok: false, error: "That option does not apply to this order yet." }, { status: 400, headers: noStore });
  }

  const { data: existing } = await db
    .from("store_order_issues")
    .select("reference,category,description,status,created_at,updated_at,customer_note,callback_requested")
    .eq("order_id", auth.order.id)
    .in("status", ["OPEN", "IN_REVIEW", "WAITING_ON_TEAM"])
    .order("created_at", { ascending: false })
    .limit(1);
  const open = (existing || []).find((row) => issueIsOpen(row.status));
  if (open) {
    return NextResponse.json(
      { ok: false, error: "An issue is already open for this order.", issue: toPublicIssue(open) },
      { status: 409, headers: noStore },
    );
  }

  const now = new Date().toISOString();
  const reference = mintIssueReference();
  const { data: created, error } = await db
    .from("store_order_issues")
    .insert({
      reference,
      order_id: auth.order.id,
      order_no: auth.order.order_no,
      category,
      description,
      status: "OPEN",
      priority: category === "DAMAGE_ISSUE" || category === "ADDRESS_ISSUE" ? "high" : "normal",
      source: "customer_tracking_page",
      callback_requested: !!body?.callback_requested,
      created_at: now,
      updated_at: now,
    })
    .select("id,reference,category,description,status,created_at,updated_at,customer_note,callback_requested")
    .single();
  if (error || !created) {
    return NextResponse.json({ ok: false, error: "Could not save the issue. Please try again." }, { status: 400, headers: noStore });
  }
  await db.from("store_order_issue_events").insert({
    issue_id: created.id,
    order_id: auth.order.id,
    event: "created",
    to_status: "OPEN",
    actor_type: "customer",
    body: description,
    visibility: "customer",
    created_at: now,
  });
  return NextResponse.json({ ok: true, issue: toPublicIssue(created) }, { headers: noStore });
}
