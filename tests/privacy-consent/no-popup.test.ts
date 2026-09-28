import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { hasMarketingConsent } from "../../lib/analytics/ga4.ts";
import {
  consentChoiceForNewVisitor,
  optionalTrackingAllowed,
  preservedConsentChoice,
  purgeLegacyConsentUiFlags,
  shouldShowConsentPrompt,
} from "../../lib/analytics/consentPrompt.ts";

const banner = readFileSync(new URL("../../components/analytics/ConsentBanner.tsx", import.meta.url), "utf8");
const footer = readFileSync(new URL("../../components/public/PublicFooter.tsx", import.meta.url), "utf8");
const privacy = readFileSync(new URL("../../app/(site)/privacy/page.tsx", import.meta.url), "utf8");
const tracker = readFileSync(new URL("../../components/analytics/Tracker.tsx", import.meta.url), "utf8");
const checkout = readFileSync(new URL("../../components/notes/CheckoutForm.tsx", import.meta.url), "utf8");
const ga4mp = readFileSync(new URL("../../lib/analytics/ga4mp.ts", import.meta.url), "utf8");
const thirdParty = readFileSync(new URL("../../components/analytics/ThirdParty.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");

const PATHS = [
  "/",
  "/notes",
  "/notes/polity",
  "/notes/economy",
  "/notes/cart",
  "/notes/checkout",
  "/notes/track",
  "/courses",
  "/webinars",
  "/dashboard",
  "/portal",
  "/admin",
  "/login",
  "/payment/status",
];

const PASSIVE = ["mount", "route", "timer", "scroll", "missing_cookie", "legacy_open", "reload"] as const;

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

describe("privacy consent popup stays closed", () => {
  test("fresh, accepted, and rejected visitors never get an automatic popup", () => {
    for (const reason of PASSIVE) {
      for (const path of PATHS) {
        assert.equal(shouldShowConsentPrompt(reason, path), false, `${reason} ${path}`);
      }
    }
    assert.equal(shouldShowConsentPrompt("privacy_settings", "/privacy"), true);
    assert.equal(consentChoiceForNewVisitor(), null);
  });

  test("existing accept and reject choices stay as stored", () => {
    const accepted = preservedConsentChoice({ analytics: true, marketing: true, version: 1 });
    const rejected = preservedConsentChoice({ analytics: false, marketing: false, version: 1 });
    assert.deepEqual(accepted, { analytics: true, marketing: true, version: 1 });
    assert.deepEqual(rejected, { analytics: false, marketing: false, version: 1 });
    assert.equal(optionalTrackingAllowed(accepted, "analytics"), true);
    assert.equal(optionalTrackingAllowed(accepted, "marketing"), true);
    assert.equal(optionalTrackingAllowed(rejected, "analytics"), false);
    assert.equal(optionalTrackingAllowed(rejected, "marketing"), false);
    assert.equal(optionalTrackingAllowed(null, "analytics"), false);
    assert.equal(optionalTrackingAllowed(null, "marketing"), false);
    assert.equal(hasMarketingConsent(), false);
  });

  test("legacy popup-open flags are removed and cannot open the banner", () => {
    const local = memoryStore({
      show_cookie_banner: "true",
      privacy_modal_open: "1",
      nsa_consent: "{\"analytics\":true,\"marketing\":true,\"version\":1}",
      nsa_attr: "keep",
    });
    const session = memoryStore({ consent_seen: "1", consent_prompted: "1" });
    purgeLegacyConsentUiFlags(local, session);
    assert.equal(local.getItem("show_cookie_banner"), null);
    assert.equal(local.getItem("privacy_modal_open"), null);
    assert.equal(session.getItem("consent_seen"), null);
    assert.equal(session.getItem("consent_prompted"), null);
    assert.ok(local.getItem("nsa_consent")?.includes("marketing\":true"));
    assert.equal(local.getItem("nsa_attr"), "keep");
    assert.equal(shouldShowConsentPrompt("legacy_open"), false);
  });

  test("the banner has no automatic open, overlay lock, or forced accept", () => {
    assert.equal(banner.match(/setOpen\(true\)/g)?.length, 1);
    assert.match(banner, /PRIVACY_SETTINGS_EVENT/);
    assert.match(banner, /useState\(false\)/);
    assert.doesNotMatch(banner, /setTimeout|setInterval|We value your privacy|aria-modal|document\.body\.style\.overflow/);
    assert.doesNotMatch(banner, /if \(!c \|\| c\.version/);
    assert.match(banner, /type="button"/);
    assert.match(layout, /<ConsentBanner \/>/);
    assert.match(footer, /PrivacySettingsButton/);
    assert.match(privacy, /PrivacySettingsButton/);
    assert.doesNotMatch(footer, /fixed |z-\[60\]/);
  });

  test("first-party attribution, checkout consent, and purchase dedupe stay in place", () => {
    assert.match(tracker, /captureAttribution\(\)/);
    assert.match(tracker, /trackClient\("page_view"/);
    assert.doesNotMatch(tracker, /nsa_consent|hasMarketingConsent/);
    assert.match(checkout, /useState\(false\)/);
    assert.match(checkout, /marketing_consent: marketingConsent/);
    assert.match(ga4mp, /ga_purchase_sent_at/);
    assert.match(ga4mp, /\.is\("ga_purchase_sent_at", null\)/);
    assert.match(thirdParty, /if \(!consent\) return/);
    assert.match(thirdParty, /if \(consent\.marketing\) loadMetaPixel\(\)/);
    assert.match(thirdParty, /if \(consent\.analytics\) loadPostHog\(\)/);
  });
});
