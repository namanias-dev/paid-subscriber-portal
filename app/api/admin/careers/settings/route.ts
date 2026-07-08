import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getCareersSettings, updateCareersSettings } from "@/lib/careers/store";
import { sanitizeFormFields, sanitizeSubjects } from "@/lib/careers/formFields";
import type { CareersSettings } from "@/lib/careers/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requirePermission("manage_careers"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const settings = await getCareersSettings();
    return NextResponse.json({ ok: true, settings });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load settings." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    if (!(await requirePermission("manage_careers"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Partial<CareersSettings> = {};
    if (body.accepting_applications !== undefined) patch.accepting_applications = body.accepting_applications !== false;
    if (body.subjects !== undefined) patch.subjects = sanitizeSubjects(body.subjects);
    if (body.default_form_fields !== undefined) patch.default_form_fields = sanitizeFormFields(body.default_form_fields);
    if (body.notify_email !== undefined) {
      const email = String(body.notify_email || "").trim().slice(0, 200);
      patch.notify_email = email || null;
    }
    const settings = await updateCareersSettings(patch);
    return NextResponse.json({ ok: true, settings });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message || "Failed to save settings." }, { status: 500 });
  }
}
