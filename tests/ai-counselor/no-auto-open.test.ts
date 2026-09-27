import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { COUNSELLOR_AUTO_OPEN, shouldAutoOpenCounsellor } from "../../lib/ai-agent/conversationPolicy.ts";

const widget = readFileSync(new URL("../../components/ai-agent/AiCounselorWidget.tsx", import.meta.url), "utf8");
const sheet = readFileSync(new URL("../../components/ai-agent/AiChatSheet.tsx", import.meta.url), "utf8");
const mount = readFileSync(new URL("../../components/ai-agent/AiCounselorMount.tsx", import.meta.url), "utf8");

describe("counsellor auto-open is off", () => {
  test("the policy never schedules an automatic open", () => {
    assert.equal(COUNSELLOR_AUTO_OPEN, false);
    assert.equal(shouldAutoOpenCounsellor(), false);
  });

  test("the widget has no timer and no scroll listener", () => {
    assert.doesNotMatch(widget, /setTimeout|setInterval/);
    assert.doesNotMatch(widget, /addEventListener\(\s*["']scroll["']/);
    assert.doesNotMatch(widget, /minDelayMs|maxDelayMs|scrollFraction|autoTriggered/);
    assert.match(widget, /onClick=\{openSheet\}/);
    assert.match(widget, /Chat with a Naman IAS counsellor/);
    assert.match(widget, /data-notes-dodge/);
    assert.match(widget, /naman-sir-teaches/);
  });

  test("ai_widget_opened fires from the sheet that mounts on an open, not from a timer", () => {
    assert.match(sheet, /ai_widget_opened/);
    assert.doesNotMatch(widget, /ai_widget_opened/);
    assert.match(widget, /ai_widget_dismissed/);
    assert.match(widget, /open && sessionId/);
  });

  test("the public mount still hides the widget unless the flag is on", () => {
    assert.match(mount, /publicWidget/);
    assert.doesNotMatch(mount, /setTimeout|addEventListener/);
  });
});
