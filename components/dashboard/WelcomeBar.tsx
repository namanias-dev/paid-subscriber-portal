"use client";

import { getPlan } from "@/lib/config";
import { daysLeft, planUsedPercent, isExpiringSoon } from "@/lib/dates";
import StreakCounter from "./StreakCounter";
import CountdownBadge from "./CountdownBadge";
import type { Student } from "@/lib/types";

export default function WelcomeBar({ student }: { student: Student }) {
  const firstName = student.name.split(" ")[0];
  const plan = getPlan(student.plan ?? "");
  const lifetime = student.expiry_date === null;
  const left = daysLeft(student.expiry_date);
  const pct = planUsedPercent(student.start_date, student.expiry_date);
  const expiringSoon = isExpiringSoon(student.expiry_date);

  return (
    <div className="card overflow-hidden p-0">
      <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg,#0057FF,#3D8BFF)" }} />
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl sm:text-2xl">Welcome back, {firstName}! 🎯</h2>
          <StreakCounter count={student.streak_count || 0} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink2">
            {plan?.name} —{" "}
            {lifetime ? (
              <span className="font-semibold text-saffron">∞ Lifetime</span>
            ) : (
              <span className={expiringSoon ? "font-semibold text-warning" : "font-semibold text-primary"}>
                {Math.max(0, left)} days remaining
              </span>
            )}
          </span>
          <CountdownBadge targetYear={student.target_year} />
        </div>

        {!lifetime && (
          <div className="mt-3 h-1.5 w-full rounded-full bg-surface">
            <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}

        {!lifetime && expiringSoon && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#fef3e2] px-3 py-2 text-sm text-warning">
            <span>⚠️ Expiring soon — only {Math.max(0, left)} days left!</span>
            <a href="/dashboard/profile" className="btn btn-secondary px-3 py-1 text-xs">Renew now</a>
          </div>
        )}
      </div>
    </div>
  );
}
