import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import {
  getOrientationVideosForTarget,
  getOrientationAssignmentsForContent,
  assignOrientationVideo,
  unassignOrientationVideo,
  reorderOrientationVideos,
  setOrientationTargetsForContent,
} from "@/lib/dataProvider";
import type { PermissionKey } from "@/lib/permissions";
import type { OrientationTargetType, OrientationRole } from "@/lib/types";

export const dynamic = "force-dynamic";

// Either content/courses OR content/webinars editors can manage orientation links
// (the picker lives in the Content tab, Course form, and Webinar form).
const PERMS: PermissionKey[] = ["content_courses", "content_webinars"];

function asTargetType(v: unknown): OrientationTargetType | null {
  return v === "course" || v === "webinar" ? v : null;
}
function asRole(v: unknown): OrientationRole {
  return v === "starter" ? "starter" : "orientation";
}

/**
 * GET ?targetType=course&targetId=… → assigned library videos for that
 *   course/webinar's After-Registration section (resolved with content rows).
 * GET ?contentId=… → every assignment for one library video (where it's used).
 */
export async function GET(req: Request) {
  if (!(await requireAnyPermission(PERMS))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const contentId = searchParams.get("contentId");
  if (contentId) {
    const assignments = await getOrientationAssignmentsForContent(contentId);
    return NextResponse.json({ ok: true, assignments });
  }
  const targetType = asTargetType(searchParams.get("targetType"));
  const targetId = searchParams.get("targetId");
  if (!targetType || !targetId) {
    return NextResponse.json({ ok: false, error: "Missing targetType/targetId." }, { status: 400 });
  }
  const videos = await getOrientationVideosForTarget(targetType, targetId);
  return NextResponse.json({ ok: true, videos });
}

export async function POST(req: Request) {
  if (!(await requireAnyPermission(PERMS))) {
    return NextResponse.json({ ok: false, error: "Forbidden — content access required." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");

  try {
    if (action === "assign") {
      const contentId = String(body.contentId || "");
      const targetType = asTargetType(body.targetType);
      const targetId = String(body.targetId || "");
      if (!contentId || !targetType || !targetId) {
        return NextResponse.json({ ok: false, error: "Missing fields." }, { status: 400 });
      }
      const assignment = await assignOrientationVideo({ contentId, targetType, targetId, role: asRole(body.role) });
      return NextResponse.json({ ok: true, assignment });
    }

    if (action === "unassign") {
      const contentId = String(body.contentId || "");
      const targetType = asTargetType(body.targetType);
      const targetId = String(body.targetId || "");
      if (!contentId || !targetType || !targetId) {
        return NextResponse.json({ ok: false, error: "Missing fields." }, { status: 400 });
      }
      await unassignOrientationVideo({ contentId, targetType, targetId });
      return NextResponse.json({ ok: true });
    }

    if (action === "reorder") {
      const targetType = asTargetType(body.targetType);
      const targetId = String(body.targetId || "");
      const order = Array.isArray(body.orderedContentIds) ? (body.orderedContentIds as unknown[]).map(String) : [];
      if (!targetType || !targetId) {
        return NextResponse.json({ ok: false, error: "Missing fields." }, { status: 400 });
      }
      await reorderOrientationVideos(targetType, targetId, order);
      return NextResponse.json({ ok: true });
    }

    if (action === "setTargets") {
      const contentId = String(body.contentId || "");
      if (!contentId) return NextResponse.json({ ok: false, error: "Missing content." }, { status: 400 });
      const role = asRole(body.role);
      const rawTargets = Array.isArray(body.targets) ? (body.targets as unknown[]) : [];
      const targets: { type: OrientationTargetType; id: string }[] = [];
      for (const t of rawTargets) {
        const o = t as { type?: unknown; id?: unknown };
        const type = asTargetType(o.type);
        const id = String(o.id || "");
        if (type && id) targets.push({ type, id });
      }
      await setOrientationTargetsForContent(contentId, role, targets);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update orientation assignment.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
