#!/usr/bin/env node
/**
 * Backfill orientation/starter videos into the reusable link model (dry-run first).
 *
 * Before this feature, course orientation videos were stored INLINE as
 * { title, description, url } in courses.after_registration.videos and could not
 * be reused. This script migrates each inline video into the central library:
 *   1. Find (or create, de-duped by URL) a content_items row for the video.
 *   2. Create a content_orientation_assignments row linking it to that course
 *      (role 'orientation', sort_order = its position in the inline list).
 *   3. (--apply only) Clear the migrated inline videos from the course JSON so the
 *      library picker becomes the single source of truth. Nothing is lost — the
 *      videos now render from the assignments, and originals are logged below.
 *
 * It NEVER deletes a content_items row and NEVER touches a course's other fields.
 * Re-running is safe: existing library videos and assignments are reused, not
 * duplicated.
 *
 * Usage:
 *   node scripts/backfill-orientation.mjs --dry-run   # default; reports only
 *   node scripts/backfill-orientation.mjs --apply     # writes the changes
 *
 * Env (same as the app): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const norm = (s) => (s || "").trim();
const isYouTube = (u) => /youtu\.?be/i.test(u);

async function main() {
  console.log(`\nOrientation video backfill — mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}\n`);

  const { data: courses, error } = await db.from("courses").select("id, title, after_registration");
  if (error) { console.error("Failed to read courses:", error.message); process.exit(1); }

  // Load existing video library + assignments once (for de-dupe / idempotency).
  const { data: contentRows } = await db.from("content_items").select("id, title, youtube_link, drive_link");
  const byUrl = new Map(); // url -> content_id
  for (const c of contentRows ?? []) {
    if (c.youtube_link) byUrl.set(norm(c.youtube_link), c.id);
    if (c.drive_link) byUrl.set(norm(c.drive_link), c.id);
  }
  const { data: existingAssigns } = await db.from("content_orientation_assignments").select("content_id, target_type, target_id");
  const haveAssign = new Set((existingAssigns ?? []).map((a) => `${a.content_id}|${a.target_type}|${a.target_id}`));

  let coursesWithVideos = 0;
  let videosTotal = 0;
  let createdContent = 0;
  let reusedContent = 0;
  let createdAssign = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const course of courses ?? []) {
    const ar = course.after_registration || {};
    const videos = Array.isArray(ar.videos) ? ar.videos.filter((v) => norm(v?.url)) : [];
    if (videos.length === 0) continue;
    coursesWithVideos++;
    console.log(`\nCourse "${course.title}" (${course.id}) — ${videos.length} inline video(s):`);

    let order = 0;
    for (const v of videos) {
      videosTotal++;
      const vUrl = norm(v.url);
      let contentId = byUrl.get(vUrl);

      if (contentId) {
        reusedContent++;
        console.log(`  • reuse library video ${contentId}  ← ${vUrl}`);
      } else {
        const title = norm(v.title) || `Orientation video — ${course.title}`;
        if (APPLY) {
          const row = {
            type: "recording",
            title,
            description: norm(v.description) || null,
            youtube_link: isYouTube(vUrl) ? vUrl : null,
            drive_link: isYouTube(vUrl) ? null : vUrl,
            date: today,
            is_published: true,
            course_ids: [],
            source_type: "link",
            visibility: "enrolled",
          };
          const { data: ins, error: insErr } = await db.from("content_items").insert(row).select("id").single();
          if (insErr) { console.error(`    ! failed to create content for ${vUrl}: ${insErr.message}`); continue; }
          contentId = ins.id;
        } else {
          contentId = `(new) ${title}`;
        }
        createdContent++;
        byUrl.set(vUrl, contentId);
        console.log(`  • create library video "${title}"  ← ${vUrl}`);
      }

      const akey = `${contentId}|course|${course.id}`;
      if (haveAssign.has(akey)) {
        console.log(`    = already linked (skip)`);
      } else {
        createdAssign++;
        if (APPLY) {
          const { error: aErr } = await db.from("content_orientation_assignments").insert({
            content_id: contentId,
            target_type: "course",
            target_id: course.id,
            role: "orientation",
            sort_order: order,
          });
          if (aErr) { console.error(`    ! failed to link ${contentId}: ${aErr.message}`); continue; }
        }
        haveAssign.add(akey);
        console.log(`    + link as orientation (sort ${order})`);
      }
      order++;
    }

    // Clear migrated inline videos so the library picker is the single source.
    if (APPLY) {
      const nextAr = { ...ar, videos: [] };
      const { error: uErr } = await db.from("courses").update({ after_registration: nextAr }).eq("id", course.id);
      if (uErr) console.error(`  ! failed to clear inline videos: ${uErr.message}`);
      else console.log(`    ↳ cleared ${videos.length} inline video(s) from course JSON`);
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`Courses with inline videos : ${coursesWithVideos}`);
  console.log(`Inline videos processed    : ${videosTotal}`);
  console.log(`Library videos created     : ${createdContent}`);
  console.log(`Library videos reused      : ${reusedContent}`);
  console.log(`Assignments created        : ${createdAssign}`);
  console.log(APPLY ? `\nDone (changes written).\n` : `\nDry-run only — re-run with --apply to write.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
