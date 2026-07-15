"use client";

import { useState } from "react";
import Link from "next/link";
import { formatINR } from "@/lib/dates";
import { startPayment } from "@/lib/startPayment";
import type { Course } from "@/lib/types";

export default function EnrollClient({ course }: { course: Course }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<{ code: string; finalAmount: number; discount: number } | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);

  const isPaid = course.price > 0;
  const payable = applied ? applied.finalAmount : course.price;

  async function applyCoupon() {
    if (!coupon.trim()) return;
    setCouponMsg(null);
    const res = await fetch("/api/v1/coupons/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemType: "course", slug: course.slug, code: coupon.trim() }),
    });
    const data = await res.json();
    if (data.ok) {
      setApplied({ code: data.code, finalAmount: data.finalAmount, discount: data.discount });
      setCouponMsg(`Coupon applied — you save ${formatINR(data.discount)}.`);
    } else {
      setApplied(null);
      setCouponMsg(data.error || "Invalid coupon.");
    }
  }

  async function proceed(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !/^\d{10}$/.test(phone)) {
      setError("Enter your name and a valid 10-digit mobile.");
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address, or leave it blank.");
      return;
    }
    setLoading(true);
    try {
      // capture the intent as a lead regardless of payment outcome
      await fetch("/api/public/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone,
          email,
          source: "Website",
          campaign: "Enroll",
          course_interest: course.title,
          source_form: "enroll_intent",
        }),
      }).catch(() => {});

      const result = await startPayment({
        itemType: "course",
        courseSlug: course.slug,
        name: name.trim(),
        email: email.trim(),
        mobile: phone,
        couponCode: applied?.code,
      });
      if (!result.ok) {
        setError(result.error || "Could not start payment.");
        setLoading(false);
      }
      // On success the helper navigates away; keep the button disabled.
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="container-wide section">
      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <Link href={`/courses/${course.slug}`} className="text-sm text-primary">← Back to course</Link>
          <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">Enroll: {course.title}</h1>
          <p className="mt-3 text-ink2">{course.description}</p>

          <div className="card mt-6 p-5">
            <div className="flex items-center justify-between">
              <span className="text-ink2">Course fee</span>
              <span className="font-semibold">{course.price === 0 ? "Free" : formatINR(course.price)}</span>
            </div>
            {course.gst && (
              <div className="mt-2 flex items-center justify-between text-sm text-muted">
                <span>GST</span><span>As applicable</span>
              </div>
            )}
            {applied && (
              <div className="mt-2 flex items-center justify-between text-sm text-success">
                <span>Coupon {applied.code}</span><span>− {formatINR(applied.discount)}</span>
              </div>
            )}
            <div className="mt-3 border-t border-line pt-3 flex items-center justify-between">
              <span className="font-semibold">Total today</span>
              <span className="font-heading text-xl text-primary">{payable === 0 ? "Free" : formatINR(payable)}</span>
            </div>
          </div>
        </div>

        <div>
          <div className="card p-6 lg:sticky lg:top-24">
            <h3 className="text-xl">Your details</h3>
            <form onSubmit={proceed} className="mt-5 space-y-3">
              <input className="input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
              <input
                className="input"
                placeholder="10-digit mobile *"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              />
              <input
                className="input"
                type="email"
                placeholder="Email (optional)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {isPaid && (
                <div>
                  <div className="flex gap-2">
                    <input
                      className="input uppercase"
                      placeholder="Coupon code"
                      value={coupon}
                      onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                    />
                    <button type="button" onClick={applyCoupon} className="btn btn-secondary whitespace-nowrap text-sm">Apply</button>
                  </div>
                  {couponMsg && <p className={`mt-1 text-xs ${applied ? "text-success" : "text-danger"}`}>{couponMsg}</p>}
                </div>
              )}
              {error && <p className="text-sm text-danger">{error}</p>}
              <button type="submit" disabled={loading} className="btn btn-primary w-full">
                {loading ? "Starting…" : payable === 0 ? "Confirm Booking" : `Pay ${formatINR(payable)} →`}
              </button>
              <p className="text-center text-xs text-muted">Secure checkout via ICICI Eazypay.</p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
