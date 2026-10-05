import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  COUNSELOR_QUERY_OPEN_KEYS,
  LEGACY_COUNSELOR_OPEN_KEYS,
  counselorOpensForReason,
  counselorOpensFromQuery,
  isWidgetAllowedPath,
  purgeLegacyCounselorOpenFlags,
  shouldAutoOpenCounselor,
} from "../../lib/ai-agent/conversationPolicy.ts";

const widget = readFileSync(new URL("../../components/ai-agent/AiCounselorWidget.tsx", import.meta.url), "utf8");
const sheet = readFileSync(new URL("../../components/ai-agent/AiChatSheet.tsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../../lib/ai-agent/conversationStore.ts", import.meta.url), "utf8");

const PASSIVE = [
  "mount",
  "route",
  "timer",
  "scroll",
  "inactivity",
  "exit_intent",
  "storage",
  "query",
  "focus",
] as const;

function memoryStore(seed: Record<string, string>) {
  const data = { ...seed };
  return {
    data,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    removeItem(key: string) {
      delete data[key];
    },
  };
}

describe("AI counselor stays closed until a launcher action", () => {
  test("page mount, route change, timer, scroll, and inactivity stay closed", () => {
    for (const reason of PASSIVE) {
      assert.equal(shouldAutoOpenCounselor(reason), false, reason);
      assert.equal(counselorOpensForReason(reason), false, reason);
    }
    assert.equal(counselorOpensForReason("click"), true);
    assert.equal(counselorOpensForReason("keyboard"), true);
  });

  test("legacy localStorage and sessionStorage open flags are removed and do not open", () => {
    const local = memoryStore({
      nsa_ai_opened_session: "1",
      nsa_ai_dismissed_at: "1",
      counselor_open: "true",
      ai_conversations: "keep-me",
    });
    const session = memoryStore({
      nsa_ai_opened_session: "1",
      chat_open: "true",
      assistant_open: "true",
    });
    const removed = purgeLegacyCounselorOpenFlags(local, session);
    for (const key of LEGACY_COUNSELOR_OPEN_KEYS) {
      assert.equal(local.getItem(key), null, key);
      assert.equal(session.getItem(key), null, key);
    }
    assert.equal(local.getItem("ai_conversations"), "keep-me");
    assert.ok(removed.includes("nsa_ai_opened_session"));
    assert.equal(shouldAutoOpenCounselor("storage"), false);
    assert.equal(counselorOpensForReason("storage"), false);
  });

  test("query parameters never open the counselor", () => {
    const samples = [
      "",
      "?",
      "?chat=open",
      "?counselor=1",
      "?assistant=open",
      "?chat=open&counselor=1&assistant=open",
      "chat=open",
    ];
    for (const sample of samples) {
      assert.equal(counselorOpensFromQuery(sample), false, sample);
    }
    assert.deepEqual([...COUNSELOR_QUERY_OPEN_KEYS], ["chat", "counselor", "assistant"]);
    assert.equal(counselorOpensForReason("query"), false);
  });

  test("Notes Store and checkout paths do not auto-open", () => {
    for (const path of [
      "/notes",
      "/notes/polity",
      "/notes/economy",
      "/notes/cart",
      "/notes/track",
      "/",
      "/courses/upsc-foundation",
      "/webinars/demo",
    ]) {
      assert.equal(isWidgetAllowedPath(path), true, path);
      assert.equal(shouldAutoOpenCounselor("mount"), false);
    }
    assert.equal(isWidgetAllowedPath("/admin/notes"), false);
    assert.equal(isWidgetAllowedPath("/dashboard"), false);
    assert.equal(isWidgetAllowedPath("/courses/safalta/enroll"), false);
    assert.equal(isWidgetAllowedPath("/payment/status"), false);
    // Notes checkout hides the launcher so nothing covers the sticky pay bar.
    assert.equal(isWidgetAllowedPath("/notes/checkout"), false);
    assert.equal(isWidgetAllowedPath("/notes/checkout?utm_source=ig"), false);
  });

  test("the widget has a single user-action open and no passive triggers", () => {
    assert.equal(widget.match(/setOpen\(true\)/g)?.length, 1);
    assert.match(widget, /const openCounselorFromUserAction = useCallback\(\(\) => \{\s*setOpen\(true\);/s);
    assert.match(widget, /onClick=\{openCounselorFromUserAction\}/);
    assert.match(widget, /type="button"/);
    assert.match(widget, /useState\(false\)/);
    assert.match(widget, /setOpen\(false\)/);
    assert.match(widget, /\[pathname\]/);
    assert.match(widget, /purgeLegacyCounselorOpenFlags\(window\.localStorage, window\.sessionStorage\)/);
    assert.doesNotMatch(widget, /setTimeout|setInterval|addEventListener\(\s*["']scroll["']/);
    assert.doesNotMatch(widget, /onFocus=\{|searchParams|TRIGGER_POLICY|openSheet\(/);
    assert.match(widget, /data-notes-dodge/);
    assert.match(widget, /naman-sir-teaches/);
  });

  test("opened analytics and conversation history stay on the manual sheet", () => {
    assert.match(sheet, /ai_widget_opened/);
    assert.doesNotMatch(widget, /ai_widget_opened/);
    assert.match(widget, /ai_widget_dismissed/);
    assert.match(store, /ai_conversations/);
    assert.doesNotMatch(store, /nsa_ai_opened_session|counselor_open/);
  });
});
