import { redirect } from "next/navigation";
import { pageSession } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const session = await pageSession();
  redirect(session?.is_super ? "/aiva" : "/login");
}
