import { requireSuperAdmin } from "@/lib/adminGuard";
import ActivityLogClient from "@/components/admin/ActivityLogClient";

export const dynamic = "force-dynamic";

export default async function AdminActivityPage() {
  if (!(await requireSuperAdmin())) {
    return (
      <div className="card p-8 text-center">
        <p className="text-lg font-semibold">Super Admin only</p>
        <p className="mt-1 text-sm text-ink2">The Activity Log is restricted to super administrators.</p>
      </div>
    );
  }
  return <ActivityLogClient />;
}
