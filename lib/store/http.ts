import { NextResponse } from "next/server";
import { storeEnabled } from "@/lib/store/flags";

export function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function requireLiveStore() {
  if (!(await storeEnabled())) {
    return noStoreJson({ ok: false, error: "not found" }, 404);
  }
  return null;
}
