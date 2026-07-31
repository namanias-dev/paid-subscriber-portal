"use client";

import ExecutiveDashboard from "@/components/admin/ExecutiveDashboard";
import DuplicateEnrollmentAlert from "@/components/admin/DuplicateEnrollmentAlert";

export default function AdminDashboard() {
  return (
    <div>
      {/* Super-admin-only: flags duplicate active enrollments (renders nothing otherwise). */}
      <DuplicateEnrollmentAlert />
      <ExecutiveDashboard />
    </div>
  );
}
