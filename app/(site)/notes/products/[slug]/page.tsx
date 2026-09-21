import { notFound, permanentRedirect } from "next/navigation";
import { getProductBySlug } from "@/lib/store/catalogue";
import { notesProductPath, resolveNotesProductSlug } from "@/lib/store/paths";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LegacyNotesProductPage({ params }: { params: { slug: string } }) {
  const slug = resolveNotesProductSlug(params.slug);
  const product = await getProductBySlug(slug);
  if (product) permanentRedirect(notesProductPath(product.slug));
  notFound();
}
