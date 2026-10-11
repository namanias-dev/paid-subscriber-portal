import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { STORE_CACHE_TAG } from "@/lib/store/catalogue";
import { copyObject, headObject, signPutUrl } from "@/lib/r2";
import {
  MODERN_HISTORY_VIDEO_FULL_KEY,
  MODERN_HISTORY_VIDEO_SOURCE_KEY,
  isModernHistoryPublicMediaKey,
} from "@/lib/store/modernHistoryMedia";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: Request): boolean {
  const expected = (process.env.NOTES_MEDIA_INGEST_TOKEN || "").trim();
  if (!expected) return false;
  const got = (req.headers.get("x-notes-media-ingest") || "").trim();
  if (!got || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!authorized(req)) return noStore({ ok: false, error: "Forbidden" }, 403);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return noStore({ ok: false, error: "json required" }, 400);
  const action = String((body as { action?: string }).action || "");

  try {
    if (action === "sign") {
      const key = String((body as { key?: string }).key || "");
      const contentType = String((body as { contentType?: string }).contentType || "application/octet-stream");
      if (!isModernHistoryPublicMediaKey(key)) return noStore({ ok: false, error: "key not allowed" }, 400);
      const url = await signPutUrl(key, contentType, 900);
      return noStore({ ok: true, key, url });
    }

    if (action === "copy-video") {
      const head = await headObject(MODERN_HISTORY_VIDEO_SOURCE_KEY);
      if (!head) return noStore({ ok: false, error: "source video missing" }, 404);
      await copyObject(MODERN_HISTORY_VIDEO_SOURCE_KEY, MODERN_HISTORY_VIDEO_FULL_KEY, "video/mp4");
      revalidateTag(STORE_CACHE_TAG);
      return noStore({
        ok: true,
        key: MODERN_HISTORY_VIDEO_FULL_KEY,
        source: MODERN_HISTORY_VIDEO_SOURCE_KEY,
        bytes: head.contentLength ?? null,
      });
    }

    if (action === "head") {
      const key = String((body as { key?: string }).key || "");
      if (!isModernHistoryPublicMediaKey(key) && key !== MODERN_HISTORY_VIDEO_SOURCE_KEY) {
        return noStore({ ok: false, error: "key not allowed" }, 400);
      }
      const head = await headObject(key);
      return noStore({ ok: true, key, exists: Boolean(head), bytes: head?.contentLength ?? null, contentType: head?.contentType ?? null });
    }

    if (action === "revalidate") {
      revalidateTag(STORE_CACHE_TAG);
      return noStore({ ok: true });
    }

    return noStore({ ok: false, error: "unknown action" }, 400);
  } catch (e) {
    return noStore({ ok: false, error: (e as Error).message }, 500);
  }
}
