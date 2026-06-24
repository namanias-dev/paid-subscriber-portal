"use client";

import { useState } from "react";
import { formatDate } from "@/lib/dates";
import RenewModal from "./RenewModal";
import type { Student } from "@/lib/types";

export default function ExpiredView({ student }: { student: Student | null }) {
  const [open, setOpen] = useState(true);
  // Revoked (is_active === false) vs auto-expired (date passed) get distinct, on-brand messaging.
  const revoked = student ? student.is_active === false : false;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#f3c0c0] bg-[#fdeaea] p-5 text-center">
        <div className="mb-2 text-3xl">🔒</div>
        <h2 className="text-xl">{revoked ? "Your access is paused" : "Your access has expired"}</h2>
        <p className="mt-1 text-sm text-ink2">
          {revoked
            ? "Your access has been paused. Please contact us to restore it — your data is safe."
            : student?.expiry_date
              ? `Your access expired on ${formatDate(student.expiry_date)}. Renew to continue.`
              : "Renew to continue your UPSC preparation."}
        </p>
        <button onClick={() => setOpen(true)} className="btn btn-primary mx-auto mt-4">{revoked ? "Contact us to renew" : "Renew now"}</button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card relative overflow-hidden p-4">
            <div className="pointer-events-none select-none blur-sm">
              <div className="mb-2 h-4 w-2/3 rounded bg-surface" />
              <div className="mb-1 h-3 w-full rounded bg-surface" />
              <div className="h-3 w-1/2 rounded bg-surface" />
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl">🔒</span>
            </div>
          </div>
        ))}
      </div>

      <RenewModal open={open} onClose={() => setOpen(false)} currentPlan={student?.plan ?? undefined} />
    </div>
  );
}
