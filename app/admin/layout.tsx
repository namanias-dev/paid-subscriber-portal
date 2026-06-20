import AdminShell from "@/components/admin/AdminShell";

export const metadata = { title: "Admin — Naman IAS Academy" };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
