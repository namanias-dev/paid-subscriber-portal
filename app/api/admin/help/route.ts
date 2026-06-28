import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { requireAdmin } from "@/lib/adminGuard";
import { HELP_SLUGS } from "@/lib/help/registry";
import { getSiteSettings } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

const DOCS_DIR = path.join(process.cwd(), "docs", "staff");

async function readDoc(slug: string): Promise<string | null> {
  // Guard against path traversal — only known slugs are ever read.
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  try {
    return await fs.readFile(path.join(DOCS_DIR, `${slug}.md`), "utf8");
  } catch {
    return null;
  }
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const docs: Record<string, string> = {};
  await Promise.all(
    HELP_SLUGS.map(async (slug) => {
      const content = await readDoc(slug);
      if (content) docs[slug] = content;
    })
  );

  // Contact details for the "Ask a question" link (from live site settings).
  let contact = { whatsapp: "", email: "" };
  try {
    const settings = await getSiteSettings();
    const brand = (settings?.brand ?? {}) as { whatsapp?: string; support_phone?: string; support_email?: string };
    contact = {
      whatsapp: (brand.whatsapp || brand.support_phone || "").toString(),
      email: (brand.support_email || "").toString(),
    };
  } catch {
    // Non-fatal — the panel falls back to email/WhatsApp being optional.
  }

  return NextResponse.json({ ok: true, docs, contact });
}
