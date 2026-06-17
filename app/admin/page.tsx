"use client";

import { useCallback, useEffect, useState } from "react";
import Logo from "@/components/ui/Logo";
import AdminLogin from "@/components/admin/AdminLogin";
import StatsRow from "@/components/admin/StatsRow";
import AddStudentForm from "@/components/admin/AddStudentForm";
import StudentsTab from "@/components/admin/StudentsTab";
import ContentTab from "@/components/admin/ContentTab";
import { CardSkeleton } from "@/components/ui/Skeleton";
import type { Student } from "@/lib/types";
import type { Stats } from "@/lib/dataProvider";

type AuthState = "checking" | "out" | "in";

export default function AdminPage() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [tab, setTab] = useState<"students" | "content">("students");
  const [students, setStudents] = useState<Student[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/students", { cache: "no-store" });
      if (res.status === 401) {
        setAuth("out");
        return;
      }
      const data = await res.json();
      if (data.ok) {
        setStudents(data.students);
        setStats(data.stats);
        setAuth("in");
      } else {
        setAuth("out");
      }
    } catch {
      setAuth("out");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

  async function logout() {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setAuth("out");
  }

  if (auth === "checking") {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <CardSkeleton />
      </div>
    );
  }

  if (auth === "out") {
    return <AdminLogin onSuccess={loadStudents} />;
  }

  return (
    <div>
      <header
        className="sticky top-0 z-40 border-b"
        style={{ background: "rgba(10,22,40,0.92)", borderColor: "rgba(231,76,60,0.4)", backdropFilter: "blur(12px)" }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Logo size={36} variant="red" />
            <div className="leading-tight">
              <div className="font-heading text-lg text-text">Admin Panel</div>
              <div className="text-[10px] uppercase tracking-widest text-muted">
                Naman IAS Academy
              </div>
            </div>
            <span
              className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: "rgba(231,76,60,0.18)", color: "#ff9a8f" }}
            >
              ADMIN
            </span>
          </div>
          <button onClick={logout} className="btn-outline px-3 py-1.5 text-sm">
            Logout
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <StatsRow stats={stats} />

        <div className="flex gap-2">
          <TabBtn active={tab === "students"} onClick={() => setTab("students")}>
            Students
          </TabBtn>
          <TabBtn active={tab === "content"} onClick={() => setTab("content")}>
            Content
          </TabBtn>
        </div>

        {tab === "students" ? (
          <div className="space-y-5">
            <AddStudentForm onAdded={loadStudents} />
            {loading ? (
              <CardSkeleton />
            ) : (
              <StudentsTab students={students} onChanged={loadStudents} />
            )}
          </div>
        ) : (
          <ContentTab />
        )}
      </main>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg px-4 py-2 text-sm font-semibold transition"
      style={{
        background: active ? "linear-gradient(135deg,#c9a84c,#e8c96a)" : "transparent",
        color: active ? "#0a1628" : "var(--muted)",
        border: active ? "none" : "1px solid var(--border)",
      }}
    >
      {children}
    </button>
  );
}
