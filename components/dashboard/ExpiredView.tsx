"use client";

import { useState } from "react";
import { formatDate } from "@/lib/dates";
import RenewModal from "./RenewModal";
import type { Student } from "@/lib/types";

export default function ExpiredView({ student }: { student: Student | null }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="space-y-4">
      <div
        className="rounded-2xl border p-5 text-center"
        style={{ background: "rgba(231,76,60,0.1)", borderColor: "rgba(231,76,60,0.4)" }}
      >
        <div className="mb-2 text-3xl">🔒</div>
        <h2 className="font-heading text-xl text-text">Your access has expired</h2>
        <p className="mt-1 text-sm text-muted">
          {student?.expiry_date
            ? `Your access expired on ${formatDate(student.expiry_date)}. Renew to continue.`
            : "Renew to continue your UPSC preparation."}
        </p>
        <button onClick={() => setOpen(true)} className="btn-gold mx-auto mt-4">
          Renew now
        </button>
      </div>

      {/* Blurred locked content teaser */}
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card relative overflow-hidden p-4">
            <div className="pointer-events-none select-none blur-sm">
              <div className="mb-2 h-4 w-2/3 rounded bg-white/10" />
              <div className="mb-1 h-3 w-full rounded bg-white/5" />
              <div className="h-3 w-1/2 rounded bg-white/5" />
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl">🔒</span>
            </div>
          </div>
        ))}
      </div>

      <RenewModal open={open} onClose={() => setOpen(false)} currentPlan={student?.plan} />
    </div>
  );
}
