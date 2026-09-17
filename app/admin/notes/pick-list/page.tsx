import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import PrintButton from "@/components/notes/admin/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notes pick list" };

export default async function PickListPage() {
  if (!(await requirePermission("store_manage_orders"))) notFound();
  const db = storeDb();
  if (!db) {
    return <p>Store database unavailable.</p>;
  }
  const { data: openOrders } = await db
    .from("store_orders")
    .select("id,order_no")
    .in("status", ["ORDER_CONFIRMED", "PROCESSING", "PRINTING", "QUALITY_CHECK", "READY_TO_PACK"]) as unknown as {
    data: Array<{ id: string; order_no: string }> | null;
  };
  const orderIds = (openOrders || []).map((o) => o.id);
  const orderNoById = new Map((openOrders || []).map((o) => [o.id, o.order_no]));
  const { data } = orderIds.length
    ? ((await db.from("store_order_items").select("order_id,sku_snapshot,name_snapshot,qty").in("order_id", orderIds)) as unknown as {
        data: Array<{ order_id: string; sku_snapshot: string; name_snapshot: string; qty: number }> | null;
      })
    : { data: [] as Array<{ order_id: string; sku_snapshot: string; name_snapshot: string; qty: number }> };

  const grouped = new Map<string, { name: string; qty: number; orders: string[] }>();
  for (const row of data || []) {
    const g = grouped.get(row.sku_snapshot) || { name: row.name_snapshot, qty: 0, orders: [] };
    g.qty += row.qty;
    const orderNo = orderNoById.get(row.order_id);
    if (orderNo) g.orders.push(orderNo);
    grouped.set(row.sku_snapshot, g);
  }

  return (
    <div className="print:p-0">
      <div className="mb-4 flex items-center justify-between print:mb-2">
        <h1 className="text-2xl font-bold">Pick list</h1>
        <PrintButton />
      </div>
      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-slate-50 text-left">
            <th className="border p-2">SKU</th>
            <th className="border p-2">Title</th>
            <th className="border p-2">Qty</th>
            <th className="border p-2">Orders</th>
          </tr>
        </thead>
        <tbody>
          {[...grouped.entries()].map(([sku, g]) => (
            <tr key={sku}>
              <td className="border p-2 font-mono">{sku}</td>
              <td className="border p-2">{g.name}</td>
              <td className="border p-2 tabular-nums">{g.qty}</td>
              <td className="border p-2 text-xs">{g.orders.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
