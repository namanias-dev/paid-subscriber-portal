import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import StoreSubnav from "@/components/notes/StoreSubnav";
import { storeEnabled } from "@/lib/store/flags";

const cachedEnabled = unstable_cache(async () => storeEnabled(), ["notes-store-enabled"], { revalidate: 20 });

export default async function NotesLayout({ children }: { children: React.ReactNode }) {
  if (!(await cachedEnabled())) notFound();
  return (
    <div className="bg-[var(--ca-slate-50,#f4f1ea)]">
      <StoreSubnav />
      {children}
    </div>
  );
}
