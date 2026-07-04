"use client";

import CeoOverview from "@/components/admin/CeoOverview";
import DuplicateEnrollmentAlert from "@/components/admin/DuplicateEnrollmentAlert";

export default function AdminDashboard() {
  return (
    <div>
      {/* Super-admin-only: flags duplicate active enrollments (renders nothing otherwise). */}
      <DuplicateEnrollmentAlert />
      <CeoOverview />
    </div>
  );
}
