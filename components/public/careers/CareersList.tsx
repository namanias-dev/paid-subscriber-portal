"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, MapPin, Briefcase, ArrowRight } from "lucide-react";

export interface PositionCardData {
  id: string;
  title: string;
  slug: string;
  roleType: string;
  roleLabel: string;
  jobType: string;
  jobLabel: string;
  location: string;
  city: string;
  salary: string | null;
  subjects: string[];
  summary: string | null;
}

export default function CareersList({ positions }: { positions: PositionCardData[] }) {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<string>("all");
  const [location, setLocation] = useState<string>("all");
  const [subject, setSubject] = useState<string>("all");

  const roleOptions = useMemo(() => uniq(positions.map((p) => p.roleLabel)), [positions]);
  const locationOptions = useMemo(() => uniq(positions.map((p) => p.city).filter(Boolean)), [positions]);
  const subjectOptions = useMemo(() => uniq(positions.flatMap((p) => p.subjects)), [positions]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return positions.filter((p) => {
      if (role !== "all" && p.roleLabel !== role) return false;
      if (location !== "all" && p.city !== location) return false;
      if (subject !== "all" && !p.subjects.includes(subject)) return false;
      if (term) {
        const hay = `${p.title} ${p.summary || ""} ${p.subjects.join(" ")} ${p.location}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [positions, q, role, location, subject]);

  return (
    <div>
      {/* Search + filters */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input
            className="input pl-10"
            placeholder="Search roles…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search roles"
          />
        </div>
        <FilterSelect label="Role type" value={role} onChange={setRole} options={roleOptions} allLabel="All roles" />
        <FilterSelect label="Location" value={location} onChange={setLocation} options={locationOptions} allLabel="All locations" />
        <FilterSelect label="Subject" value={subject} onChange={setSubject} options={subjectOptions} allLabel="All subjects" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-[var(--ca-slate-200)] bg-white p-10 text-center">
          <p className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">No roles match your filters</p>
          <p className="mt-1 text-sm text-[var(--ca-slate-700)]">Try clearing a filter or searching a different term.</p>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <PositionCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function PositionCard({ p }: { p: PositionCardData }) {
  return (
    <Link
      href={`/careers/${p.slug}`}
      className="ca-card group flex flex-col p-5 focus:outline-none ca-focus"
    >
      <div className="flex items-center gap-2">
        <span className="pill pill-blue">{p.roleLabel}</span>
        <span className="pill pill-gray">{p.jobLabel}</span>
      </div>
      <h3 className="mt-3 font-heading text-lg font-bold text-[var(--ca-navy-900)]">{p.title}</h3>

      {p.location && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--ca-slate-700)]">
          <MapPin size={15} aria-hidden="true" /> {p.location}
        </p>
      )}
      {p.salary && (
        <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-[var(--ca-navy-800)]">
          <Briefcase size={15} aria-hidden="true" /> {p.salary}
        </p>
      )}

      {p.summary && <p className="mt-3 line-clamp-3 text-sm text-[var(--ca-slate-700)]">{p.summary}</p>}

      {p.subjects.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {p.subjects.slice(0, 5).map((s) => (
            <span key={s} className="rounded-full bg-[var(--ca-slate-50)] px-2.5 py-0.5 text-xs font-medium text-[var(--ca-slate-700)]">
              {s}
            </span>
          ))}
          {p.subjects.length > 5 && (
            <span className="rounded-full bg-[var(--ca-slate-50)] px-2.5 py-0.5 text-xs font-medium text-[var(--ca-slate-400)]">
              +{p.subjects.length - 5}
            </span>
          )}
        </div>
      )}

      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
        View &amp; apply <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="all">{allLabel}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean))).sort();
}
