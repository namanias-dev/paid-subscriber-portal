/**
 * AI Counselor Agent — COPY LIBRARY.
 *
 * ALL user-facing agent copy lives here so tone is consistent and auditable.
 *
 * GUARDRAILS baked into every line (see the Phase 2 brief):
 *  - Warm, concise mentor tone. Human, not salesy.
 *  - NEVER promise selection / rank / "guaranteed success".
 *  - NEVER use fake scarcity ("only 2 seats!", "offer ends tonight").
 *  - NEVER invent prices / dates / discounts / seat counts — those come ONLY
 *    from the live offer resolver (server data). Copy here is offer-agnostic.
 *  - No PII is ever embedded in copy.
 *
 * VOICE: written for Indian UPSC aspirants (~18–25, mostly beginners, basic-to-
 * moderate English). Simple, clear, short sentences. Warm senior/mentor tone —
 * encouraging but honest. Uses familiar UPSC context (NCERT, GS, Prelims, Mains,
 * newspaper, current affairs). No hype, no fancy words.
 *
 * Anything dynamic (a course title, a webinar date, a price) is injected by the
 * engine from resolved live offers — this file only holds the static scaffolding.
 */

export const AGENT_NAME = "Naman Counsellor";

/** Fallbacks used when NOTHING is live (never guess / never pitch a dead offer). */
export const FALLBACKS = {
  noLiveOffer:
    "I don't want to guess here. Let me connect you with a counsellor who can give you an honest, personal answer.",
  noWebinar:
    "No masterclass is scheduled right now. But I can help you plan your prep, or tell you about the next one when it opens.",
  noCourse:
    "I don't see a course that fits you right now. A counsellor can walk you through the current options properly.",
  generic:
    "Let me get a counsellor to help you with this personally, so you get the right answer.",
} as const;

/** Root greeting + menu. Context-aware openers are added by the engine. */
export const ROOT = {
  greetingDefault:
    "Hi! I'm your prep counsellor at Naman IAS. Tell me where you are in your UPSC journey and I'll guide you the right way.",
  greetingReturning:
    "Welcome back! Want to continue where we left off, or is there something new I can help with?",
  menuPrompt: "What do you need help with today?",
  options: {
    beginner: "I'm just starting UPSC",
    course: "Help me pick a course",
    webinar: "Any free masterclass?",
    offline: "Offline classes in Chandigarh",
    resource: "Free study material",
    counselor: "Talk to a counsellor",
  },
} as const;

/** (1) Beginner roadmap. */
export const BEGINNER = {
  intro:
    "Good decision. A clear plan saves you months. Just a few quick questions and I'll make you a simple roadmap.",
  askTargetYear: "Which attempt are you aiming for?",
  askBackground: "Where are you right now in your prep?",
  backgrounds: {
    fresher: "Total beginner",
    someBasics: "Read some basics (NCERT etc.)",
    repeater: "I've attempted before",
  },
  roadmapTitle: "Your starting roadmap",
  roadmapSubtitle:
    "A steady plan, not a shortcut. Being regular matters far more than speed.",
  steps: {
    foundation: {
      title: "1 · Build your base",
      detail:
        "Finish the core NCERTs first. Get comfortable with the syllabus and exam pattern before anything else.",
    },
    coreGs: {
      title: "2 · Cover GS, subject by subject",
      detail:
        "Move to standard books one subject at a time. Start the newspaper and daily current affairs early — don't leave it for the end.",
    },
    answerWriting: {
      title: "3 · Practise and revise",
      detail:
        "Start answer writing and revise in regular cycles. Mock tests turn what you know into marks.",
    },
    mentorship: {
      title: "4 · Get guidance",
      detail:
        "A proper programme or mentor keeps you on track and corrects your direction early.",
    },
  },
  afterRoadmap:
    "Want me to suggest a foundation programme that fits this plan, or send you free resources to start today?",
} as const;

/** (2) Course recommendation. */
export const COURSE = {
  intro:
    "Happy to help you find the right fit. Two quick questions so I suggest honestly, not randomly.",
  askStage: "Where are you in your preparation?",
  askMode: "How do you like to study?",
  modes: {
    online: "Online",
    offline: "Offline (Chandigarh)",
    either: "Either is fine",
  },
  recoIntro:
    "Based on what you told me, this looks like the closest fit from what's running right now:",
  recoOutro:
    "Have a look at the details on the page. If you want, a counsellor can explain the syllabus and fee options to you.",
  noMatch:
    "Nothing running right now is a clean match for you. Instead of pushing the wrong course, let me connect you with a counsellor.",
} as const;

/** (3) Webinar / masterclass recommendation. */
export const WEBINAR = {
  intro: "Let me check what's open for registration right now.",
  found: "Here's what's open for registration right now:",
  outro:
    "Want me to save your spot? Just your name and number to start.",
  none: FALLBACKS.noWebinar,
} as const;

/** (4) Offline / Chandigarh. */
export const OFFLINE = {
  intro:
    "Yes — Naman IAS runs classroom batches in Chandigarh along with online batches. Do you prefer studying in a real classroom?",
  askInterest: "What would help you most?",
  options: {
    batches: "Current offline batches",
    visit: "Plan a campus visit",
    callback: "Ask someone to call me",
  },
  batchesIntro:
    "Here are the offline batches running right now:",
  visit:
    "The best way to decide is to visit the campus and meet the faculty. Share your number and a counsellor will help you fix a convenient time — no pressure.",
  none:
    "I don't want to guess the current offline schedule. A counsellor can give you exact batch timings and seats.",
} as const;

/** (5) Quiz-result follow-up. */
export const QUIZ = {
  greeting:
    "Nice work finishing that quiz. Just showing up and testing yourself is half the job. Want to turn this into steady improvement?",
  askGoal: "What would help you most right now?",
  options: {
    weakAreas: "Fix my weak areas",
    testSeries: "Regular test practice",
    mentor: "Talk to a mentor",
  },
  weakAreas:
    "The fastest gain comes from revising the exact topics you missed, then testing again within a week. A proper programme builds this loop for you.",
  testSeries:
    "Regular, timed practice with real feedback is what moves your score. Let me show you what's running, or connect you with a mentor to plan it.",
} as const;

/** (6) Payment-abandoned recovery. Uses REAL status; never says "failed". */
export const RECOVERY = {
  initiated:
    "Looks like you started enrolling but didn't finish. That's totally fine, it happens. Nothing is lost and your details are safe.",
  offerResume:
    "Whenever you're ready, you can continue from where you left off. Want the link, or would you like a counsellor to help you finish?",
  resumeLabel: "Continue enrolment",
  paidLine:
    "Good news — our records show this is already done, so there's nothing you need to do here.",
  statusNeutral:
    "Your enrolment isn't complete yet. No seat is booked until payment is done, so let's finish it properly when you're ready.",
  helpCta: "Help me finish this",
  checkCta: "Check my enrolment status",
  checkTitle: "Check your status",
  checkSubtitle: "Enter the number you enrolled with — I'll only show your own status.",
  submitCheck: "Check status",
  allClear:
    "Good news — our records show your enrolment is already complete. Nothing pending from your side.",
  noneFound:
    "I couldn't find a pending enrolment for that number. If that seems wrong, a counsellor can check it with you.",
} as const;

/** (7) Counselor handoff. */
export const HANDOFF = {
  intro:
    "Let's get you a real person. Share your name and number and a counsellor will reach out — honest guidance, no spam.",
  whatsappHint:
    "Prefer WhatsApp? You can also message the team directly.",
  submitted:
    "Done — a counsellor will get in touch with you soon. Till then, feel free to explore the free resources.",
  submittedNoConsent:
    "Thanks! To have a counsellor call you, I first need your permission to contact you.",
} as const;

/** (8) Post-registration nurture. */
export const NURTURE = {
  greeting:
    "You're registered — well done. A little prep beforehand makes any session far more useful.",
  tips: "Want a quick checklist to get the most out of it?",
  checklistTitle: "Get the most out of your session",
  checklist: {
    calendar: {
      title: "Block the time",
      detail: "Add it to your calendar and set a reminder so it doesn't slip.",
    },
    questions: {
      title: "Come with questions",
      detail: "Note down 2–3 doubts you're stuck on — you'll get much more out of it.",
    },
    resources: {
      title: "Warm up first",
      detail: "Skim a related free resource beforehand so the session makes more sense.",
    },
  },
  outro: "Anything else I can help you prepare?",
} as const;

/** (9) Resource conversion. */
export const RESOURCE = {
  intro:
    "There's plenty of solid, free material to get you going. What are you looking for?",
  options: {
    browse: "Browse UPSC resources",
    currentAffairs: "Current affairs",
    plan: "Help me use them well",
  },
  browse:
    "Here's our free UPSC resource hub — start with the basics and build up from there.",
  browseLabel: "Open free resources",
  currentAffairs:
    "Daily current affairs is the habit that sets serious aspirants apart. Start today and keep it regular.",
  planNudge:
    "Free resources are a great start. If you want some structure and accountability around them, a counsellor can help you plan.",
} as const;

/** Consent explainer copy (shown before any phone capture, when required). */
export const CONSENT = {
  title: "Quick permission",
  body:
    "To have a counsellor reach out, I need your okay to contact you about your UPSC prep. We'll use your details only for that — no spam, and you can opt out anytime.",
  accept: "Yes, you can contact me",
  decline: "Not now",
} as const;

/** Lead-capture form copy. */
export const CAPTURE = {
  callbackTitle: "Talk to a counsellor",
  callbackSubtitle: "Share your details and we'll reach out to you personally.",
  webinarTitle: "Register for the session",
  webinarSubtitle: "Just your name and number to save your spot.",
  courseTitle: "Get course guidance",
  courseSubtitle: "A counsellor will walk you through the details.",
  submitCallback: "Request callback",
  submitWebinar: "Register free",
  submitGeneric: "Send",
  thanks:
    "Thanks! A counsellor will be in touch soon. No pressure — I'm here if you have more questions.",
} as const;

/** Small connective phrases. */
export const COMMON = {
  anythingElse: "Anything else I can help with?",
  backToStart: "Start over",
  talkToCounselor: "Talk to a counsellor",
  seeResources: "See free resources",
  notNow: "Not right now",
  yes: "Yes, please",
  no: "No thanks",
} as const;
