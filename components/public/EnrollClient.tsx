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

  const isPaid = course.price > 0;

  async function proceed(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !/^\d{10}$/.test(phone)) {
      setError("Enter your name and a valid 10-digit mobile.");
      return;
    }
    if (isPaid && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("A valid email is required for payment.");
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
        }),
      }).catch(() => {});

      const result = await startPayment({
        itemType: "course",
        courseSlug: course.slug,
        name: name.trim(),
        email: email.trim(),
        mobile: phone,
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
            {course.emi_amount && (
              <div className="mt-2 flex items-center justify-between text-sm text-muted">
                <span>EMI option</span><span>{formatINR(course.emi_amount)}/mo × {course.emi_months}</span>
              </div>
            )}
            <div className="mt-3 border-t border-line pt-3 flex items-center justify-between">
              <span className="font-semibold">Total today</span>
              <span className="font-heading text-xl text-primary">{course.price === 0 ? "Free" : formatINR(course.price)}</span>
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
                placeholder="10-digit mobile"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              />
              <input
                className="input"
                placeholder={isPaid ? "Email (required)" : "Email (optional)"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {error && <p className="text-sm text-danger">{error}</p>}
              <button type="submit" disabled={loading} className="btn btn-primary w-full">
                {loading ? "Starting…" : course.price === 0 ? "Confirm Booking" : `Pay ${formatINR(course.price)} →`}
              </button>
              <p className="text-center text-xs text-muted">Secure checkout via ICICI Eazypay.</p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
