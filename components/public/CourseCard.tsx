"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { formatINR } from "@/lib/dates";
import type { Course } from "@/lib/types";

export function discountPct(price: number, original: number | null): number | null {
  if (!original || original <= price) return null;
  return Math.round(((original - price) / original) * 100);
}

export default function CourseCard({ course }: { course: Course }) {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ rx: 0, ry: 0 });
  const off = discountPct(course.price, course.original_price);

  function onMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setT({ rx: -py * 6, ry: px * 6 });
  }

  return (
    <div style={{ perspective: 900 }}>
      <div
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={() => setT({ rx: 0, ry: 0 })}
        className="tilt card card-hover flex h-full flex-col p-5"
        style={{ transform: `rotateX(${t.rx}deg) rotateY(${t.ry}deg)` }}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <span className="pill pill-blue">{course.category}</span>
          {off && <span className="pill pill-green">{off}% OFF</span>}
        </div>

        <h3 className="text-[17px] leading-snug">{course.title}</h3>
        <p className="mt-1.5 line-clamp-2 text-sm text-ink2">{course.description}</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {course.modes.map((m) => (
            <span key={m} className="pill pill-gray">{m}</span>
          ))}
        </div>

        <div className="mt-4 flex items-end justify-between">
          <div>
            {course.price === 0 ? (
              <span className="font-heading text-2xl text-india">Free</span>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="font-heading text-2xl text-ink">{formatINR(course.price)}</span>
                {course.original_price && (
                  <span className="text-sm text-muted line-through">{formatINR(course.original_price)}</span>
                )}
              </div>
            )}
          </div>
        </div>

        <Link href={`/courses/${course.slug}`} className="btn btn-secondary mt-4 w-full">
          View Details →
        </Link>
      </div>
    </div>
  );
}
