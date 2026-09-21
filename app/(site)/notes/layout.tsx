import { notFound } from "next/navigation";
import StoreSubnav from "@/components/notes/StoreSubnav";
import { storeEnabled } from "@/lib/store/flags";

export default async function NotesLayout({ children }: { children: React.ReactNode }) {
  if (!(await storeEnabled())) notFound();
  return (
    <div className="max-w-full overflow-x-clip bg-[var(--ca-surface)]">
      <StoreSubnav />
      {children}
    </div>
  );
}
