import { NextResponse } from "next/server";
import { storeDb } from "@/lib/store/db";
import { storeEnabled } from "@/lib/store/flags";
import { getObject } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Serves watermarked sample-page derivatives only. The original_key column is
 * never read, so a guessed UUID cannot reach the un-watermarked scan.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await storeEnabled())) {
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return new NextResponse("Not found", { status: 404 });

  const { data } = await db
    .from("store_product_media")
    .select("id,kind,r2_key,is_public")
    .eq("id", params.id)
    .maybeSingle();

  if (!data || data.kind !== "sample_page" || !data.r2_key) {
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (!data.r2_key.startsWith("store-private/sample-pages/")) {
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const obj = await getObject(data.r2_key);
  if (!obj) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  return new NextResponse(obj.body.transformToWebStream(), {
    status: 200,
    headers: {
      "Content-Type": obj.contentType || "image/webp",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      ...(obj.contentLength != null ? { "Content-Length": String(obj.contentLength) } : {}),
    },
  });
}
