"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import OrderDetail, { type AdminOrder } from "@/components/notes/admin/orders/OrderDetail";
import CourierPicker from "@/components/notes/admin/orders/CourierPicker";

export default function NotesOrderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [writes, setWrites] = useState(false);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const [compare, setCompare] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/notes/orders?id=${encodeURIComponent(params.id)}`, { cache: "no-store" });
    const json = await res.json();
    const row = (json.orders || [])[0] as AdminOrder | undefined;
    setWrites(Boolean(json.writes_authorized));
    if (!row) setMissing(true);
    else setOrder(row);
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-[var(--ca-navy)]">This order is not available.</p>
        <button type="button" onClick={() => router.push("/admin/notes")} className="mt-3 min-h-11 text-sm font-semibold text-[var(--ca-navy)]">Back to orders</button>
      </div>
    );
  }
  if (!order) return <div className="p-6 text-sm text-[var(--ca-navy)]/60">Loading order…</div>;

  return (
    <>
    <OrderDetail
      order={order}
      busy={busy}
      writesAuthorized={writes}
      presentation="page"
      onClose={() => router.push("/admin/notes")}
      onRefresh={() => void load()}
      onCompare={() => setCompare(true)}
      act={(fn, ok) => {
        setBusy(true);
        void (async () => {
          try {
            const res = await fn();
            const json = await res.json();
            if (!json.ok) window.alert(json.error || "Could not update the order.");
            else if (ok) window.history.replaceState(null, "", window.location.href);
            await load();
          } finally {
            setBusy(false);
          }
        })();
      }}
    />
      {compare && (
        <CourierPicker
          orderId={order.id}
          open
          writesAuthorized={writes}
          weight={order.shipment?.weight_grams || 0}
          length={order.shipment?.length_cm || 0}
          width={order.shipment?.width_cm || 0}
          height={order.shipment?.height_cm || 0}
          onClose={() => setCompare(false)}
          onBooked={() => {
            setCompare(false);
            void load();
          }}
        />
      )}
    </>
  );
}
