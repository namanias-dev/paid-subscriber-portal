import { notFound } from "next/navigation";
import StoreSubnav from "@/components/notes/StoreSubnav";
import { storeEnabled } from "@/lib/store/flags";

export default async function NotesLayout({ children }: { children: React.ReactNode }) {
  if (!(await storeEnabled())) notFound();
  return (
    <div className="bg-[var(--ca-slate-50,#f4f1ea)]">
      <StoreSubnav />
      {children}
    </div>
  );
}
