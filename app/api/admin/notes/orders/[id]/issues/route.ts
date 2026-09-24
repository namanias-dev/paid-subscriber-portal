import { NextResponse } from "next/server";
import { getActionActor, requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { clampIssueText, issueStatusAllowed, type IssueStatus } from "@/lib/store/issues";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: noStore });
  }
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: noStore });
  const body = (await req.json().catch(() => null)) as {
    issue_id?: string;
    status?: string;
    admin_note?: string;
    customer_note?: string;
  } | null;
  const issueId = String(body?.issue_id || "").trim();
  const status = String(body?.status || "").trim();
  const adminNote = clampIssueText(String(body?.admin_note || ""), 800);
  const customerNote = clampIssueText(String(body?.customer_note || ""), 800);
  if (!issueId || !issueStatusAllowed(status)) {
    return NextResponse.json({ ok: false, error: "Choose an issue and a status." }, { status: 400, headers: noStore });
  }
  const { data: issue } = await db
    .from("store_order_issues")
    .select("id,order_id,status,admin_note")
    .eq("id", issueId)
    .eq("order_id", params.id)
    .maybeSingle();
  if (!issue) return NextResponse.json({ ok: false, error: "not found" }, { status: 404, headers: noStore });

  const now = new Date().toISOString();
  const next: Record<string, unknown> = { status, updated_at: now };
  if (adminNote) next.admin_note = adminNote;
  if (customerNote) next.customer_note = customerNote;
  if (status === "RESOLVED") next.resolved_at = now;
  if (status === "CLOSED") next.closed_at = now;
  if (status === "OPEN" || status === "IN_REVIEW" || status === "WAITING_ON_TEAM") {
    next.resolved_at = null;
    next.closed_at = null;
  }
  const { error } = await db.from("store_order_issues").update(next).eq("id", issue.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400, headers: noStore });

  const from = issue.status as IssueStatus;
  await db.from("store_order_issue_events").insert({
    issue_id: issue.id,
    order_id: issue.order_id,
    event: from === status ? "note" : "status",
    from_status: from,
    to_status: status,
    actor_type: "admin",
    actor_name: actor?.name || "admin",
    body: [adminNote && `Internal: ${adminNote}`, customerNote && `Customer: ${customerNote}`].filter(Boolean).join("\n") || null,
    visibility: customerNote ? "customer" : "internal",
    created_at: now,
  });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
