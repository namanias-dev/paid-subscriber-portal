import type { PublicOrder } from "@/lib/store/orders";

export default function OrderStatus({ order }: { order: PublicOrder }) {
  return (
    <div className="mx-auto max-w-xl">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ca-gold-dark,#9a7b2f)]">{order.order_no}</p>
      <h1 className="mt-2 font-heading text-3xl font-bold text-[var(--ca-navy)]">{order.stage_label}</h1>
      {order.promised_delivery_date && (
        <p className="mt-2 text-sm text-[var(--ca-navy)]/60">Promised by {order.promised_delivery_date}</p>
      )}
      <ol className="mt-8 space-y-3">
        {order.steps.map((s) => (
          <li key={s.id} className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${s.done ? "bg-[var(--ca-gold,#d4af37)]" : "bg-[var(--ca-navy)]/20"}`} />
            <span className={s.done ? "font-medium text-[var(--ca-navy)]" : "text-[var(--ca-navy)]/40"}>{s.label}</span>
          </li>
        ))}
      </ol>
      <ul className="mt-8 divide-y rounded-2xl border border-[var(--ca-navy)]/10 bg-white">
        {order.items.map((it, i) => (
          <li key={i} className="flex justify-between p-4 text-sm">
            <span>
              {it.name} × {it.qty}
            </span>
            <span>{it.total}</span>
          </li>
        ))}
        <li className="flex justify-between p-4 font-semibold">
          <span>Total</span>
          <span>{order.total_label}</span>
        </li>
      </ul>
      {order.awb && (
        <p className="mt-4 text-sm text-[var(--ca-navy)]/70">
          {order.courier} · AWB {order.awb}
        </p>
      )}
    </div>
  );
}
