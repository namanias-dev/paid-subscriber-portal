import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { revalidateTag } from "next/cache";
import { STORE_CACHE_TAG } from "@/lib/store/catalogue";
import {
  ALLOWED_MEDIA_EXT,
  MAX_MEDIA_BYTES,
  deleteProductMedia,
  listProductMedia,
  normalizeExt,
  reorderProductMedia,
  setProductCover,
  uploadProductPhoto,
  uploadSamplePage,
} from "@/lib/store/media/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function guard() {
  return requirePermission("store_manage_catalogue");
}

/** GET /api/admin/notes/media?product_id= — list a product's media. */
export async function GET(req: Request) {
  if (!(await guard())) return noStore({ ok: false, error: "Forbidden" }, 403);
  const productId = new URL(req.url).searchParams.get("product_id") || "";
  if (!productId) return noStore({ ok: false, error: "product_id required" }, 400);
  try {
    return noStore({ ok: true, media: await listProductMedia(productId) });
  } catch (e) {
    return noStore({ ok: false, error: (e as Error).message }, 500);
  }
}

/** POST multipart: product_id, kind(photo|sample), file, [source_page_no], [alt]. */
export async function POST(req: Request) {
  if (!(await guard())) return noStore({ ok: false, error: "Forbidden" }, 403);
  const form = await req.formData().catch(() => null);
  if (!form) return noStore({ ok: false, error: "multipart form required" }, 400);

  const productId = String(form.get("product_id") || "").trim();
  const kind = String(form.get("kind") || "").trim();
  const file = form.get("file");
  if (!productId) return noStore({ ok: false, error: "product_id required" }, 400);
  if (kind !== "photo" && kind !== "sample") return noStore({ ok: false, error: "kind must be photo or sample" }, 400);
  if (!(file instanceof File)) return noStore({ ok: false, error: "file required" }, 400);
  if (file.size > MAX_MEDIA_BYTES) return noStore({ ok: false, error: "File too large (max 12 MB)." }, 413);

  const ext = normalizeExt(file.name);
  if (!ALLOWED_MEDIA_EXT.has(ext)) {
    return noStore({ ok: false, error: "Only JPG, PNG or WebP images are accepted." }, 415);
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const row =
      kind === "sample"
        ? await uploadSamplePage(productId, buffer, ext, {
            sourcePageNo: form.get("source_page_no") ? Number(form.get("source_page_no")) : null,
            alt: (form.get("alt") as string) || null,
            contentType: file.type || undefined,
          })
        : await uploadProductPhoto(productId, buffer, { alt: (form.get("alt") as string) || null });
    revalidateTag(STORE_CACHE_TAG);
    return noStore({ ok: true, media: row });
  } catch (e) {
    return noStore({ ok: false, error: (e as Error).message }, 400);
  }
}

/** PATCH: { product_id, action:"reorder", kind, order:[ids] } | { action:"set_cover", product_id, media_id } */
export async function PATCH(req: Request) {
  if (!(await guard())) return noStore({ ok: false, error: "Forbidden" }, 403);
  const body = await req.json().catch(() => null);
  if (!body) return noStore({ ok: false, error: "json body required" }, 400);
  const productId = String(body.product_id || "").trim();
  if (!productId) return noStore({ ok: false, error: "product_id required" }, 400);
  try {
    if (body.action === "reorder") {
      const kind = body.kind === "sample_page" ? "sample_page" : "photo";
      await reorderProductMedia(productId, kind, (body.order || []).map(String));
    } else if (body.action === "set_cover") {
      await setProductCover(productId, body.media_id ? String(body.media_id) : null);
    } else {
      return noStore({ ok: false, error: "unknown action" }, 400);
    }
    revalidateTag(STORE_CACHE_TAG);
    return noStore({ ok: true });
  } catch (e) {
    return noStore({ ok: false, error: (e as Error).message }, 400);
  }
}

/** DELETE /api/admin/notes/media?id= */
export async function DELETE(req: Request) {
  if (!(await guard())) return noStore({ ok: false, error: "Forbidden" }, 403);
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return noStore({ ok: false, error: "id required" }, 400);
  try {
    const res = await deleteProductMedia(id);
    if (!res) return noStore({ ok: false, error: "not found" }, 404);
    revalidateTag(STORE_CACHE_TAG);
    return noStore({ ok: true });
  } catch (e) {
    return noStore({ ok: false, error: (e as Error).message }, 400);
  }
}
