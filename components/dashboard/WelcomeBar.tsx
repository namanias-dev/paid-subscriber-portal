"use client";

import { getPlan } from "@/lib/config";
import { daysLeft, planUsedPercent, isExpiringSoon } from "@/lib/dates";
import StreakCounter from "./StreakCounter";
import CountdownBadge from "./CountdownBadge";
import type { Student } from "@/lib/types";

export default function WelcomeBar({ student }: { student: Student }) {
  const firstName = student.name.split(" ")[0];
  const plan = getPlan(student.plan);
  const lifetime = student.expiry_date === null;
  const left = daysLeft(student.expiry_date);
  const pct = planUsedPercent(student.start_date, student.expiry_date);
  const expiringSoon = isExpiringSoon(student.expiry_date);

  return (
    <div
      className="rounded-2xl p-[1.5px]"
      style={{ background: "linear-gradient(135deg,#c9a84c,#e8c96a)" }}
    >
      <div className="rounded-2xl bg-[rgba(10,22,40,0.9)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-xl text-text sm:text-2xl">
            Welcome back, {firstName}! 🎯
          </h2>
          <StreakCounter count={student.streak_count || 0} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">
            {plan?.name} —{" "}
            {lifetime ? (
              <span className="text-gold-light">∞ Lifetime</span>
            ) : (
              <span className={expiringSoon ? "text-warning" : "text-gold-light"}>
                {Math.max(0, left)} days remaining
              </span>
            )}
          </span>
          <CountdownBadge targetYear={student.target_year} />
        </div>

        {!lifetime && (
          <div className="mt-3">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {!lifetime && expiringSoon && (
          <div
            className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm"
            style={{ background: "rgba(241,196,15,0.12)", color: "#ffd54a" }}
          >
            <span>⚠️ Expiring soon — only {Math.max(0, left)} days left!</span>
            <a href="/dashboard/profile" className="btn-outline px-3 py-1 text-xs">
              Renew now
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
