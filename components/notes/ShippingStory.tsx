const STEPS = [
  { t: "Order", d: "Prepaid guest checkout. No account required." },
  { t: "Academy prepares", d: "Ready stock is picked. On-demand titles are printed for you." },
  { t: "Secure packaging", d: "Corner-protected and packed in Chandigarh for courier travel." },
  { t: "Track the shipment", d: "Once an AWB exists, you can follow the parcel from your phone." },
];

export default function ShippingStory({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "" : "rounded-3xl border border-[var(--ca-navy)]/10 bg-white p-6"}>
      <p className="ca-eyebrow text-[var(--ca-gold-dark)]">Physical delivery</p>
      <h2 className={`${compact ? "mt-2 text-xl" : "mt-2 text-2xl"} font-heading font-bold text-[var(--ca-navy)]`}>
        From the Academy desk to your door
      </h2>
      <ol className={`mt-5 grid gap-4 ${compact ? "" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
        {STEPS.map((s, i) => (
          <li key={s.t} className="relative">
            <p className="font-heading text-sm font-bold text-[var(--ca-navy)]">
              <span className="mr-2 text-[var(--ca-gold-dark)]">{i + 1}</span>
              {s.t}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--ca-navy)]/60">{s.d}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-[var(--ca-navy)]/45">Delivery dates are quoted from your PIN at checkout. We do not invent a fixed national SLA.</p>
    </div>
  );
}
