/**
 * AI Counselor Agent — GUIDED-FLOW ENGINE (provider = "guided_flow").
 *
 * A fully DETERMINISTIC, quick-reply-driven conversation engine. NO external LLM
 * calls, ever. Each turn is a pure function of (step id + resolved live offers +
 * consent state) — the same inputs always produce the same output, which makes
 * the agent auditable and safe to ship.
 *
 * State is carried in the STEP ID itself (base + query params, e.g.
 * "course:reco?stage=fresher&mode=online"), so the engine stays stateless and the
 * client just echoes the `next` step of whichever quick reply was tapped.
 *
 * ALL offers come from the live offer resolver — never hardcoded. When nothing is
 * live we fall back to the honest "let me connect you with a counsellor" copy.
 */

import { getLiveOffers, type LiveOffers, type OfferType } from "@/lib/ai-agent/offerResolver";
import {
  ROOT,
  BEGINNER,
  COURSE,
  WEBINAR,
  OFFLINE,
  QUIZ,
  RECOVERY,
  HANDOFF,
  NURTURE,
  RESOURCE,
  CAPTURE,
  COMMON,
  FALLBACKS,
} from "@/lib/ai-agent/copyLibrary";
import {
  recommendCourses,
  recommendWebinar,
  webinarCards,
  toOfferCard,
  buildBeginnerRoadmap,
  buildNurtureChecklist,
  type PrepStage,
  type StudyMode,
} from "@/lib/ai-agent/recommendationEngine";
import { routeText } from "@/lib/ai-agent/conversationPolicy";
import type {
  AgentBubble,
  AgentCard,
  AgentResponse,
  AgentTurnInput,
  FlowId,
  QuickReply,
  ResponseMeta,
} from "./types";

/* ------------------------------------------------------------------ *
 * Engine context + small builders
 * ------------------------------------------------------------------ */

export interface GuidedFlowDeps {
  /** Pre-resolved live offers (injected for tests); fetched if omitted. */
  offers?: LiveOffers;
  /** AI_AGENT_REQUIRE_MARKETING_CONSENT. */
  requireConsent: boolean;
  /** Whether the visitor has already granted marketing consent (nsa_consent). */
  hasMarketingConsent: boolean;
}

interface EngineCtx {
  offers: LiveOffers;
  requireConsent: boolean;
  hasMarketingConsent: boolean;
  params: Record<string, string>;
  page: { offerId: string | null; offerType: OfferType | null };
}

let _bubbleSeq = 0;
function bubble(text: string): AgentBubble {
  _bubbleSeq = (_bubbleSeq + 1) % 1_000_000;
  return { id: `m${Date.now().toString(36)}${_bubbleSeq}`, text };
}

function msgs(...texts: (string | null | undefined)[]): AgentBubble[] {
  return texts.filter((t): t is string => !!t && t.trim() !== "").map(bubble);
}

/** Shared quick replies reused across flows. */
const QR = {
  counselor: (): QuickReply => ({
    id: "counselor",
    label: COMMON.talkToCounselor,
    flow: "counselor_handoff",
    track: "ai_counselor_open",
    kind: "ghost",
  }),
  resources: (): QuickReply => ({
    id: "resources",
    label: COMMON.seeResources,
    flow: "resource_conversion",
    kind: "ghost",
  }),
  restart: (): QuickReply => ({
    id: "restart",
    label: COMMON.backToStart,
    flow: "root",
    kind: "ghost",
  }),
};

/* ------------------------------------------------------------------ *
 * Step id parsing (base + params)
 * ------------------------------------------------------------------ */

function parseStep(step: string): { base: string; params: Record<string, string> } {
  const [base, query] = String(step || "").split("?");
  const params: Record<string, string> = {};
  if (query) {
    for (const pair of query.split("&")) {
      const [k, v] = pair.split("=");
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
    }
  }
  return { base: base || "root:menu", params };
}

function withParams(base: string, params: Record<string, string | null | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `${base}?${parts.join("&")}` : base;
}

/* ------------------------------------------------------------------ *
 * Flow entry steps
 * ------------------------------------------------------------------ */

const FLOW_ENTRY: Record<FlowId, string> = {
  root: "root:menu",
  beginner_roadmap: "beginner:intro",
  course_reco: "course:intro",
  webinar_reco: "webinar:list",
  offline_chandigarh: "offline:intro",
  quiz_followup: "quiz:greeting",
  payment_recovery: "recovery:intro",
  counselor_handoff: "handoff:intro",
  post_registration: "nurture:greeting",
  resource_conversion: "resource:intro",
};

function flowOfStep(base: string): FlowId {
  const prefix = base.split(":")[0];
  const map: Record<string, FlowId> = {
    root: "root",
    beginner: "beginner_roadmap",
    course: "course_reco",
    webinar: "webinar_reco",
    offline: "offline_chandigarh",
    quiz: "quiz_followup",
    recovery: "payment_recovery",
    handoff: "counselor_handoff",
    nurture: "post_registration",
    resource: "resource_conversion",
    capture: "counselor_handoff",
  };
  return map[prefix] || "root";
}

/* ------------------------------------------------------------------ *
 * Node result + registry
 * ------------------------------------------------------------------ */

interface NodeResult {
  messages: AgentBubble[];
  quickReplies: QuickReply[];
  cards: AgentCard[];
  meta?: ResponseMeta;
}

type NodeFn = (c: EngineCtx) => NodeResult;

/** Build a lead-capture card + consent-aware meta. */
function captureCard(opts: {
  intent: string;
  title: string;
  subtitle: string | null;
  fields: ("name" | "phone" | "email" | "city" | "target_year")[];
  submitLabel: string;
  nextStep: string;
  offerId?: string | null;
  offerType?: OfferType | null;
  ctx: EngineCtx;
}): NodeResult {
  const requiresConsent = opts.ctx.requireConsent && !opts.ctx.hasMarketingConsent;
  const cards: AgentCard[] = [
    {
      kind: "lead_form",
      data: {
        title: opts.title,
        subtitle: opts.subtitle,
        fields: opts.fields,
        submitLabel: opts.submitLabel,
        nextStep: opts.nextStep,
        offerId: opts.offerId ?? null,
        offerType: opts.offerType ?? null,
        intent: opts.intent,
      },
    },
  ];
  return {
    messages: [],
    quickReplies: [QR.restart()],
    cards,
    meta: { requiresConsent, intent: opts.intent },
  };
}

const NODES: Record<string, NodeFn> = {
  // -------------------------------------------------- ROOT
  "root:menu": () => ({
    messages: msgs(ROOT.greetingDefault, ROOT.menuPrompt),
    quickReplies: [
      { id: "beginner", label: ROOT.options.beginner, flow: "beginner_roadmap", kind: "primary" },
      { id: "course", label: ROOT.options.course, flow: "course_reco" },
      { id: "webinar", label: ROOT.options.webinar, flow: "webinar_reco" },
      { id: "offline", label: ROOT.options.offline, flow: "offline_chandigarh" },
      { id: "resource", label: ROOT.options.resource, flow: "resource_conversion" },
      { id: "counselor", label: ROOT.options.counselor, flow: "counselor_handoff" },
    ],
    cards: [],
    meta: { intent: "menu" },
  }),

  // -------------------------------------------------- (1) BEGINNER ROADMAP
  "beginner:intro": () => ({
    messages: msgs(BEGINNER.intro, BEGINNER.askBackground),
    quickReplies: [
      { id: "fresher", label: BEGINNER.backgrounds.fresher, next: withParams("beginner:roadmap", { stage: "fresher" }), kind: "primary" },
      { id: "someBasics", label: BEGINNER.backgrounds.someBasics, next: withParams("beginner:roadmap", { stage: "someBasics" }) },
      { id: "repeater", label: BEGINNER.backgrounds.repeater, next: withParams("beginner:roadmap", { stage: "repeater" }) },
    ],
    cards: [],
    meta: { intent: "beginner" },
  }),
  "beginner:roadmap": (c) => ({
    messages: msgs(BEGINNER.afterRoadmap),
    quickReplies: [
      { id: "programme", label: "Suggest a programme", next: withParams("course:mode", { stage: c.params.stage || "fresher" }), kind: "primary" },
      QR.resources(),
      QR.counselor(),
    ],
    cards: [{ kind: "roadmap", data: buildBeginnerRoadmap() }],
    meta: { intent: "beginner_roadmap" },
  }),

  // -------------------------------------------------- (2) COURSE RECOMMENDATION
  "course:intro": () => ({
    messages: msgs(COURSE.intro, COURSE.askStage),
    quickReplies: [
      { id: "fresher", label: BEGINNER.backgrounds.fresher, next: withParams("course:mode", { stage: "fresher" }), kind: "primary" },
      { id: "someBasics", label: BEGINNER.backgrounds.someBasics, next: withParams("course:mode", { stage: "someBasics" }) },
      { id: "repeater", label: BEGINNER.backgrounds.repeater, next: withParams("course:mode", { stage: "repeater" }) },
    ],
    cards: [],
    meta: { intent: "course" },
  }),
  "course:mode": (c) => ({
    messages: msgs(COURSE.askMode),
    quickReplies: [
      { id: "online", label: COURSE.modes.online, next: withParams("course:reco", { stage: c.params.stage, mode: "online" }), kind: "primary" },
      { id: "offline", label: COURSE.modes.offline, next: withParams("course:reco", { stage: c.params.stage, mode: "offline" }) },
      { id: "either", label: COURSE.modes.either, next: withParams("course:reco", { stage: c.params.stage, mode: "either" }) },
    ],
    cards: [],
    meta: { intent: "course" },
  }),
  "course:reco": (c) => {
    const stage = (c.params.stage as PrepStage) || undefined;
    const mode = (c.params.mode as StudyMode) || "either";
    const matches = recommendCourses(c.offers, { stage, mode, preferOfferId: c.page.offerId, limit: 2 });
    if (matches.length === 0) {
      return {
        messages: msgs(COURSE.noMatch),
        quickReplies: [QR.counselor(), QR.resources(), QR.restart()],
        cards: [],
        meta: { intent: "course_no_match" },
      };
    }
    return {
      messages: msgs(COURSE.recoIntro, COURSE.recoOutro),
      quickReplies: [QR.counselor(), QR.resources(), QR.restart()],
      cards: matches.map((o) => ({ kind: "offer", data: toOfferCard(o) })),
      meta: { intent: "course_reco" },
    };
  },

  // -------------------------------------------------- (3) WEBINAR RECOMMENDATION
  "webinar:list": (c) => {
    const cards = webinarCards(c.offers);
    if (cards.length === 0) {
      return {
        messages: msgs(WEBINAR.none),
        quickReplies: [
          { id: "roadmap", label: "Plan my prep", flow: "beginner_roadmap", kind: "primary" },
          QR.resources(),
          QR.counselor(),
        ],
        cards: [],
        meta: { intent: "webinar_none" },
      };
    }
    const primary = recommendWebinar(c.offers, c.page.offerId);
    return {
      messages: msgs(WEBINAR.found, WEBINAR.outro),
      quickReplies: [
        primary
          ? { id: "register", label: "Register me", action: "register_webinar", next: withParams("webinar:register", { offer: primary.id }), data: { offer_id: primary.id }, track: "ai_webinar_register_click", kind: "primary" }
          : QR.counselor(),
        QR.counselor(),
        QR.restart(),
      ],
      cards: cards.map((data) => ({ kind: "offer", data })),
      meta: { intent: "webinar_reco" },
    };
  },
  "webinar:register": (c) => {
    const offerId = c.params.offer || c.page.offerId || null;
    const webinar = (c.offers.webinars || []).find((w) => w.id === offerId) || recommendWebinar(c.offers, offerId);
    if (!webinar) {
      return {
        messages: msgs(WEBINAR.none),
        quickReplies: [QR.counselor(), QR.restart()],
        cards: [],
        meta: { intent: "webinar_none" },
      };
    }
    return captureCard({
      intent: "webinar",
      title: CAPTURE.webinarTitle,
      subtitle: `${webinar.title}${webinar.duration ? ` · ${webinar.duration}` : ""}`,
      fields: ["name", "phone"],
      submitLabel: webinar.price > 0 ? "Continue" : CAPTURE.submitWebinar,
      nextStep: "capture:thanks",
      offerId: webinar.id,
      offerType: "webinar",
      ctx: c,
    });
  },

  // -------------------------------------------------- (4) OFFLINE / CHANDIGARH
  "offline:intro": () => ({
    messages: msgs(OFFLINE.intro, OFFLINE.askInterest),
    quickReplies: [
      { id: "batches", label: OFFLINE.options.batches, next: "offline:batches", kind: "primary" },
      { id: "visit", label: OFFLINE.options.visit, next: "offline:visit" },
      { id: "callback", label: OFFLINE.options.callback, flow: "counselor_handoff" },
    ],
    cards: [],
    meta: { intent: "offline" },
  }),
  "offline:batches": (c) => {
    const matches = recommendCourses(c.offers, { mode: "offline", limit: 3 });
    if (matches.length === 0) {
      return {
        messages: msgs(OFFLINE.none),
        quickReplies: [QR.counselor(), QR.restart()],
        cards: [],
        meta: { intent: "offline_none" },
      };
    }
    return {
      messages: msgs(OFFLINE.batchesIntro),
      quickReplies: [QR.counselor(), QR.restart()],
      cards: matches.map((o) => ({ kind: "offer", data: toOfferCard(o) })),
      meta: { intent: "offline_batches" },
    };
  },
  "offline:visit": (c) =>
    captureCard({
      intent: "campus_visit",
      title: OFFLINE.options.visit,
      subtitle: OFFLINE.visit,
      fields: ["name", "phone", "city"],
      submitLabel: CAPTURE.submitCallback,
      nextStep: "capture:thanks",
      ctx: c,
    }),

  // -------------------------------------------------- (5) QUIZ FOLLOW-UP
  "quiz:greeting": () => ({
    messages: msgs(QUIZ.greeting, QUIZ.askGoal),
    quickReplies: [
      { id: "weak", label: QUIZ.options.weakAreas, next: "quiz:weak", kind: "primary" },
      { id: "tests", label: QUIZ.options.testSeries, next: "quiz:tests" },
      { id: "mentor", label: QUIZ.options.mentor, flow: "counselor_handoff" },
    ],
    cards: [],
    meta: { intent: "quiz" },
  }),
  "quiz:weak": () => ({
    messages: msgs(QUIZ.weakAreas),
    quickReplies: [
      { id: "courses", label: "Show me programmes", flow: "course_reco", kind: "primary" },
      QR.resources(),
      QR.counselor(),
    ],
    cards: [],
    meta: { intent: "quiz_weak" },
  }),
  "quiz:tests": (c) => {
    const matches = recommendCourses(c.offers, { stage: "repeater", mode: "either", limit: 2 });
    return {
      messages: msgs(QUIZ.testSeries, matches.length ? null : FALLBACKS.noCourse),
      quickReplies: [QR.counselor(), QR.resources(), QR.restart()],
      cards: matches.map((o) => ({ kind: "offer", data: toOfferCard(o) })),
      meta: { intent: "quiz_tests" },
    };
  },

  // -------------------------------------------------- (6) PAYMENT-ABANDONED RECOVERY
  "recovery:intro": (c) => {
    const offerLink = c.page.offerId
      ? (c.offers.courses.find((o) => o.id === c.page.offerId)?.link ||
         c.offers.webinars.find((o) => o.id === c.page.offerId)?.link ||
         null)
      : null;
    const resume: QuickReply = offerLink
      ? { id: "resume", label: RECOVERY.resumeLabel, action: "open_url", href: offerLink, track: "ai_payment_recovery_click", kind: "primary" }
      : { id: "resume", label: RECOVERY.resumeLabel, action: "open_url", href: "/courses", track: "ai_payment_recovery_click", kind: "primary" };
    return {
      messages: msgs(RECOVERY.initiated, RECOVERY.statusNeutral, RECOVERY.offerResume),
      quickReplies: [
        resume,
        { id: "check", label: RECOVERY.checkCta, next: withParams("recovery:check", { offer: c.page.offerId || undefined }) },
        { id: "help", label: RECOVERY.helpCta, flow: "counselor_handoff" },
        QR.restart(),
      ],
      cards: [],
      meta: { intent: "payment_recovery" },
    };
  },
  // Phone-based status check: matches by phone (+ item) via /api/ai-agent/payment-recovery.
  "recovery:check": (c) => {
    const offerId = c.params.offer || c.page.offerId || null;
    const offer = offerId
      ? c.offers.courses.find((o) => o.id === offerId) || c.offers.webinars.find((o) => o.id === offerId) || null
      : null;
    return captureCard({
      intent: "payment_recovery",
      title: RECOVERY.checkTitle,
      subtitle: RECOVERY.checkSubtitle,
      fields: ["phone"],
      submitLabel: RECOVERY.submitCheck,
      nextStep: "capture:done",
      offerId: offer?.id ?? null,
      offerType: offer?.type ?? null,
      ctx: c,
    });
  },

  // -------------------------------------------------- (7) COUNSELOR HANDOFF
  "handoff:intro": (c) => {
    const cap = captureCard({
      intent: "callback",
      title: CAPTURE.callbackTitle,
      subtitle: CAPTURE.callbackSubtitle,
      fields: ["name", "phone", "city"],
      submitLabel: CAPTURE.submitCallback,
      nextStep: "capture:thanks",
      ctx: c,
    });
    return {
      ...cap,
      messages: msgs(HANDOFF.intro, HANDOFF.whatsappHint),
      quickReplies: [
        { id: "whatsapp", label: "Message on WhatsApp", action: "whatsapp", track: "ai_whatsapp_click", kind: "ghost" },
        QR.restart(),
      ],
    };
  },

  // -------------------------------------------------- (8) POST-REGISTRATION NURTURE
  "nurture:greeting": () => ({
    messages: msgs(NURTURE.greeting, NURTURE.tips),
    quickReplies: [
      { id: "yes", label: COMMON.yes, next: "nurture:checklist", kind: "primary" },
      { id: "no", label: COMMON.no, next: "capture:done" },
    ],
    cards: [],
    meta: { intent: "nurture" },
  }),
  "nurture:checklist": () => ({
    messages: msgs(NURTURE.outro),
    quickReplies: [QR.resources(), QR.counselor(), QR.restart()],
    cards: [{ kind: "roadmap", data: buildNurtureChecklist() }],
    meta: { intent: "nurture_checklist" },
  }),

  // -------------------------------------------------- (9) RESOURCE CONVERSION
  "resource:intro": () => ({
    messages: msgs(RESOURCE.intro),
    quickReplies: [
      { id: "browse", label: RESOURCE.options.browse, next: "resource:browse", kind: "primary" },
      { id: "ca", label: RESOURCE.options.currentAffairs, next: "resource:ca" },
      { id: "plan", label: RESOURCE.options.plan, flow: "beginner_roadmap" },
    ],
    cards: [],
    meta: { intent: "resource" },
  }),
  "resource:browse": () => ({
    messages: msgs(RESOURCE.browse, RESOURCE.planNudge),
    quickReplies: [
      { id: "open", label: RESOURCE.browseLabel, action: "open_url", href: "/resources", track: "ai_resource_click", kind: "primary" },
      QR.counselor(),
      QR.restart(),
    ],
    cards: [],
    meta: { intent: "resource_browse" },
  }),
  "resource:ca": () => ({
    messages: msgs(RESOURCE.currentAffairs, RESOURCE.planNudge),
    quickReplies: [
      { id: "open", label: "Open current affairs", action: "open_url", href: "/current-affairs", track: "ai_resource_click", kind: "primary" },
      QR.counselor(),
      QR.restart(),
    ],
    cards: [],
    meta: { intent: "resource_ca" },
  }),

  // -------------------------------------------------- CAPTURE TERMINALS
  "capture:thanks": () => ({
    messages: msgs(CAPTURE.thanks, COMMON.anythingElse),
    quickReplies: [QR.resources(), QR.restart()],
    cards: [],
    meta: { intent: "captured", terminal: false },
  }),
  "capture:done": () => ({
    messages: msgs(COMMON.anythingElse),
    quickReplies: [QR.resources(), QR.counselor(), QR.restart()],
    cards: [],
    meta: { intent: "done", terminal: false },
  }),
};

/* ------------------------------------------------------------------ *
 * Public entry
 * ------------------------------------------------------------------ */

/**
 * Resolve the step id for a turn:
 *  - explicit step wins,
 *  - else the flow's entry step,
 *  - else route the free text to a flow entry,
 *  - else the root menu.
 */
function resolveStepId(input: AgentTurnInput): string {
  if (input.step && String(input.step).trim()) return String(input.step).trim();
  if (input.flow && FLOW_ENTRY[input.flow]) return FLOW_ENTRY[input.flow];
  if (input.text && input.text.trim()) return FLOW_ENTRY[routeText(input.text)];
  return FLOW_ENTRY.root;
}

/** Run one deterministic turn of the guided-flow engine. */
export async function runGuidedFlow(
  input: AgentTurnInput,
  deps: GuidedFlowDeps,
): Promise<AgentResponse> {
  const offers = deps.offers ?? (await getLiveOffers());
  const stepId = resolveStepId(input);
  const { base, params } = parseStep(stepId);

  const ctx: EngineCtx = {
    offers,
    requireConsent: deps.requireConsent,
    hasMarketingConsent: deps.hasMarketingConsent,
    params,
    page: {
      offerId: input.context?.offerId ? String(input.context.offerId).slice(0, 64) : null,
      offerType: (input.context?.offerType as OfferType) || null,
    },
  };

  const node = NODES[base] || NODES["root:menu"];
  // Consent before phone capture is enforced INLINE by the capture form: the
  // ConsentNotice checkbox is required (and consent_marketing is persisted on the
  // lead) whenever `meta.requiresConsent` is set — see captureCard().
  const result = node(ctx);

  return {
    flow: flowOfStep(base),
    step: stepId,
    messages: result.messages,
    quickReplies: result.quickReplies,
    cards: result.cards,
    meta: result.meta || {},
  };
}
