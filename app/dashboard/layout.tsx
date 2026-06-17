import { DashboardProvider } from "@/components/dashboard/DashboardContext";
import DashboardNav from "@/components/layout/DashboardNav";
import BottomNav from "@/components/layout/BottomNav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardProvider>
      <DashboardNav />
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:pb-12">{children}</main>
      <BottomNav />
    </DashboardProvider>
  );
}
