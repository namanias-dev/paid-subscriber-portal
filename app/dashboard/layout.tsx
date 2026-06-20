import { DashboardProvider } from "@/components/dashboard/DashboardContext";
import StudentSidebar from "@/components/layout/StudentSidebar";
import StudentTopbar from "@/components/layout/StudentTopbar";
import BottomNav from "@/components/layout/BottomNav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <div className="min-h-screen bg-surface">
        <StudentSidebar />
        <div className="lg:pl-64">
          <StudentTopbar />
          <main className="mx-auto max-w-5xl px-4 pb-28 pt-5 lg:pb-12">{children}</main>
        </div>
        <BottomNav />
      </div>
    </DashboardProvider>
  );
}
