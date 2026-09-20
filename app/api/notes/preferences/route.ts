import { noStoreJson, requireLiveStore } from "@/lib/store/http";
import { getOrCreateInterestVoterId } from "@/lib/store/interest";
import { getVoterPreferenceIds, listPreferenceSubjects, savePreferences } from "@/lib/store/preferences";
import { sanitizePreferenceSource } from "@/lib/store/preferenceLogic";

export const dynamic = "force-dynamic";

export async function GET() {
  const dark = await requireLiveStore();
  if (dark) return dark;
  const voter = getOrCreateInterestVoterId();
  const [subjects, selected] = await Promise.all([
    listPreferenceSubjects(),
    getVoterPreferenceIds(voter.hash),
  ]);
  return noStoreJson({
    ok: true,
    subjects,
    selected,
    saved: selected.length > 0,
  });
}

export async function POST(req: Request) {
  const dark = await requireLiveStore();
  if (dark) return dark;
  let body: { category_ids?: unknown; source?: unknown } = {};
  try {
    body = (await req.json()) as { category_ids?: unknown; source?: unknown };
  } catch {
    return noStoreJson({ ok: false, error: "Invalid request." }, 400);
  }
  const result = await savePreferences({
    categoryIds: body.category_ids,
    source: sanitizePreferenceSource(body.source),
    req,
  });
  if (!result.ok) return noStoreJson({ ok: false, error: result.error }, result.status);
  return noStoreJson({
    ok: true,
    updated: result.updated,
    selected: result.selected,
    available: result.available,
    waitlist: result.waitlist,
  });
}
