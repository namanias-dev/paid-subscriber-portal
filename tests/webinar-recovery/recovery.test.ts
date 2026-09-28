import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  HANDOFF_DELAY_MS,
  HANDOFF_HISTORY_MODE,
  formatNextSession,
  handoffUrl,
  resolvePublicWebinarState,
  selectNextLiveWebinar,
  type RecoveryWebinar,
} from "../../lib/webinarRecovery";

/** 10 October 2026, 4:00 PM IST. */
const OCT_10 = "2026-10-10T10:30:00.000Z";
/** 7 November 2026, 4:00 PM IST — a later eligible session. */
const NOV_7 = "2026-11-07T10:30:00.000Z";
/** 26 September 2026, 4:00 PM IST. */
const SEP_26 = "2026-09-26T10:30:00.000Z";
/** A moment after the September session, while October is still in the future. */
const AFTER_SEPTEMBER = Date.parse("2026-09-26T12:00:00.000Z");

function webinar(partial: Partial<RecoveryWebinar> & Pick<RecoveryWebinar, "id" | "slug">): RecoveryWebinar {
  return {
    title: partial.slug,
    datetime: OCT_10,
    status: "upcoming",
    active: true,
    registration_status: "OPEN",
    auto_close_registration: true,
    session_type: "live",
    recording_link: null,
    ...partial,
  };
}

describe("resolvePublicWebinarState", () => {
  test("an upcoming open webinar stays on the normal registration page", () => {
    const october = webinar({ id: "oct", slug: "october", datetime: OCT_10 });
    const state = resolvePublicWebinarState(october, [october], AFTER_SEPTEMBER);
    assert.equal(state.outcome, "ACTIVE_UPCOMING");
  });

  test("a completed webinar with a future session resolves that session dynamically", () => {
    const september = webinar({
      id: "sep",
      slug: "september",
      datetime: SEP_26,
      status: "completed",
      active: false,
      registration_status: "CLOSED",
    });
    const october = webinar({ id: "oct", slug: "october", datetime: OCT_10, title: "October masterclass" });
    const state = resolvePublicWebinarState(september, [october], AFTER_SEPTEMBER);
    assert.equal(state.outcome, "COMPLETED_WITH_NEXT_EVENT");
    if (state.outcome === "COMPLETED_WITH_NEXT_EVENT") {
      assert.equal(state.next.id, "oct");
      assert.equal(state.next.slug, "october");
    }
  });

  test("several future webinars: the earliest start wins", () => {
    const past = webinar({
      id: "past",
      slug: "past",
      datetime: SEP_26,
      status: "completed",
      active: false,
      registration_status: "CLOSED",
    });
    const later = webinar({ id: "nov", slug: "november", datetime: NOV_7 });
    const sooner = webinar({ id: "oct", slug: "october", datetime: OCT_10 });
    const state = resolvePublicWebinarState(past, [later, sooner], AFTER_SEPTEMBER);
    assert.equal(state.outcome, "COMPLETED_WITH_NEXT_EVENT");
    if (state.outcome === "COMPLETED_WITH_NEXT_EVENT") assert.equal(state.next.id, "oct");
  });

  test("a completed webinar with nothing upcoming does not invent a successor", () => {
    const past = webinar({
      id: "past",
      slug: "past",
      datetime: SEP_26,
      status: "completed",
      active: false,
      registration_status: "CLOSED",
    });
    const alsoPast = webinar({
      id: "aug",
      slug: "august",
      datetime: "2026-08-22T10:30:00.000Z",
      status: "completed",
      active: false,
      registration_status: "CLOSED",
    });
    const state = resolvePublicWebinarState(past, [alsoPast], Date.parse("2026-12-01T00:00:00.000Z"));
    assert.equal(state.outcome, "COMPLETED_NO_NEXT_EVENT");
  });

  test("a draft or a session pulled before it starts is not found", () => {
    const draft = webinar({ id: "d", slug: "draft", registration_status: "DRAFT", active: false });
    const unpublished = webinar({
      id: "u",
      slug: "unpublished",
      active: false,
      status: "upcoming",
      datetime: OCT_10,
    });
    assert.equal(resolvePublicWebinarState(draft, [], AFTER_SEPTEMBER).outcome, "NOT_FOUND");
    assert.equal(resolvePublicWebinarState(unpublished, [], AFTER_SEPTEMBER).outcome, "NOT_FOUND");
    assert.equal(resolvePublicWebinarState(null, [], AFTER_SEPTEMBER).outcome, "NOT_FOUND");
  });

  test("a recording that is still for sale keeps the normal page", () => {
    const recording = webinar({
      id: "rec",
      slug: "recording",
      datetime: SEP_26,
      status: "completed",
      active: true,
      recording_link: "https://example.com/watch",
      registration_status: "OPEN",
    });
    const state = resolvePublicWebinarState(recording, [], AFTER_SEPTEMBER);
    assert.equal(state.outcome, "ACTIVE_UPCOMING");
  });

  test("timezone ordering uses the absolute start, not a local wall clock", () => {
    // 11:59 PM IST on 10 Oct is earlier than 12:01 AM IST on 11 Oct.
    const lateSameDay = webinar({ id: "late", slug: "late", datetime: "2026-10-10T18:29:00.000Z" });
    const afterMidnight = webinar({ id: "next-day", slug: "next-day", datetime: "2026-10-10T18:31:00.000Z" });
    const picked = selectNextLiveWebinar([afterMidnight, lateSameDay], null, AFTER_SEPTEMBER);
    assert.equal(picked?.id, "late");
  });

  test("October 10 4:00 PM IST formats as Saturday in Asia/Kolkata", () => {
    const label = formatNextSession(OCT_10);
    assert.ok(label);
    assert.match(label.weekdayDate, /Saturday/);
    assert.match(label.weekdayDate, /10 October/);
    assert.match(label.time, /4:00/);
    assert.match(label.time, /IST/);
    assert.match(label.compact, /10 Oct/);
  });
});

describe("handoff attribution", () => {
  test("keeps UTM, fbclid and gclid and drops unrelated parameters", () => {
    const url = handoffUrl(
      "/webinars/upsc-full-masterclass-by-naman-sir-10-october-2026",
      "?utm_source=ig&utm_medium=paid&utm_campaign=sept-masterclass&utm_content=reel&utm_term=upsc&fbclid=fb123&gclid=g123&phone=9876543210&token=secret",
    );
    const q = new URL(url, "https://www.namanias.com").searchParams;
    assert.equal(q.get("utm_source"), "ig");
    assert.equal(q.get("utm_medium"), "paid");
    assert.equal(q.get("utm_campaign"), "sept-masterclass");
    assert.equal(q.get("utm_content"), "reel");
    assert.equal(q.get("utm_term"), "upsc");
    assert.equal(q.get("fbclid"), "fb123");
    assert.equal(q.get("gclid"), "g123");
    assert.equal(q.get("phone"), null);
    assert.equal(q.get("token"), null);
  });

  test("an empty query stays a clean path", () => {
    assert.equal(handoffUrl("/webinars/next", ""), "/webinars/next");
  });

  test("automatic handoff waits five seconds and replaces history", () => {
    assert.equal(HANDOFF_DELAY_MS, 5000);
    assert.equal(HANDOFF_HISTORY_MODE, "replace");
  });

  test("a session that is still in progress stays on the normal page", () => {
    const live = webinar({
      id: "live",
      slug: "live",
      datetime: OCT_10,
      end_datetime: "2026-10-10T12:30:00.000Z",
      status: "live",
    });
    const during = Date.parse("2026-10-10T11:00:00.000Z");
    assert.equal(resolvePublicWebinarState(live, [], during).outcome, "ACTIVE_UPCOMING");
  });

  test("an active session past its window hands off to the earliest future event", () => {
    const stale = webinar({
      id: "stale",
      slug: "stale",
      datetime: SEP_26,
      status: "upcoming",
      active: true,
    });
    const october = webinar({ id: "oct", slug: "october", datetime: OCT_10 });
    const afterWindow = Date.parse("2026-09-26T14:00:00.000Z");
    const state = resolvePublicWebinarState(stale, [october], afterWindow);
    assert.equal(state.outcome, "COMPLETED_WITH_NEXT_EVENT");
    if (state.outcome === "COMPLETED_WITH_NEXT_EVENT") assert.equal(state.next.id, "oct");
  });
});
