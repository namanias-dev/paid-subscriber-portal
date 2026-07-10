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
 * Anything dynamic (a course title, a webinar date, a price) is injected by the
 * engine from resolved live offers — this file only holds the static scaffolding.
 */

export const AGENT_NAME = "Naman Counsellor";

/** Fallbacks used when NOTHING is live (never guess / never pitch a dead offer). */
export const FALLBACKS = {
  noLiveOffer:
    "I don't want to guess here — let me connect you with a counsellor who can give you an honest, personalised answer.",
  noWebinar:
    "There's no active masterclass scheduled right now, but I can help you plan your prep or line you up for the next one.",
  noCourse:
    "I don't see a course that's the right fit to recommend right now — a counsellor can walk you through the current options properly.",
  generic:
    "Let me get a counsellor to help you with this personally so you get the right answer.",
} as const;

/** Root greeting + menu. Context-aware openers are added by the engine. */
export const ROOT = {
  greetingDefault:
    "Hi! I'm your prep counsellor at Naman IAS. Tell me where you are in your UPSC journey and I'll point you the right way.",
  greetingReturning:
    "Welcome back! Want to pick up where we left off, or is there something new I can help with?",
  menuPrompt: "What would you like help with today?",
  options: {
    beginner: "I'm just starting UPSC prep",
    course: "Help me choose a course",
    webinar: "Any free masterclass / webinar?",
    offline: "Offline classes in Chandigarh",
    resource: "Free study resources",
    counselor: "Talk to a counsellor",
  },
} as const;

/** (1) Beginner roadmap. */
export const BEGINNER = {
  intro:
    "Great decision — starting with a clear plan saves months. A few quick questions and I'll sketch a realistic roadmap for you.",
  askTargetYear: "Which attempt are you aiming for?",
  askBackground: "How would you describe your current stage?",
  backgrounds: {
    fresher: "Complete beginner",
    someBasics: "I've read some basics (NCERTs etc.)",
    repeater: "I've attempted before",
  },
  roadmapTitle: "Your starting roadmap",
  roadmapSubtitle:
    "A grounded sequence, not a shortcut. Consistency matters far more than speed.",
  steps: {
    foundation: {
      title: "1 · Build the foundation",
      detail:
        "Finish core NCERTs and get comfortable with the syllabus and exam pattern before anything else.",
    },
    coreGs: {
      title: "2 · Cover the GS core",
      detail:
        "Move to standard sources subject by subject, and start daily current affairs early — don't leave it for the end.",
    },
    answerWriting: {
      title: "3 · Practise & revise",
      detail:
        "Begin answer writing and regular revision cycles. Mock tests turn knowledge into marks.",
    },
    mentorship: {
      title: "4 · Get guidance",
      detail:
        "A structured programme or mentor keeps you accountable and corrects your direction early.",
    },
  },
  afterRoadmap:
    "Want me to suggest a foundation programme that matches this plan, or send you free resources to begin today?",
} as const;

/** (2) Course recommendation. */
export const COURSE = {
  intro:
    "Happy to help you find the right fit. A couple of quick questions so I recommend honestly, not randomly.",
  askStage: "Where are you in your preparation?",
  askMode: "How do you prefer to study?",
  modes: {
    online: "Online",
    offline: "Offline (Chandigarh)",
    either: "Either works",
  },
  recoIntro:
    "Based on what you've shared, here's what looks like the closest fit from what's running right now:",
  recoOutro:
    "Take a look at the details on the page. If you'd like, I can have a counsellor talk you through the syllabus and fee options.",
  noMatch:
    "Nothing running right now is a clean match for what you described. Rather than push the wrong course, let me connect you with a counsellor.",
} as const;

/** (3) Webinar / masterclass recommendation. */
export const WEBINAR = {
  intro: "Let me check what's open for registration right now.",
  found: "Here's what's open right now — free to attend:",
  outro:
    "Want me to register you? It only takes your name and number.",
  none: FALLBACKS.noWebinar,
} as const;

/** (4) Offline / Chandigarh. */
export const OFFLINE = {
  intro:
    "Yes — Naman IAS runs classroom programmes in Chandigarh alongside online batches. Prefer the discipline of a physical classroom?",
  askInterest: "What would help most?",
  options: {
    batches: "Current offline batches",
    visit: "Plan a campus visit",
    callback: "Have someone call me",
  },
  batchesIntro:
    "Here are the offline-friendly programmes running right now:",
  visit:
    "The best way to decide is to see the campus and meet the faculty. Share your number and a counsellor will help you arrange a convenient time — no pressure.",
  none:
    "I don't want to guess the current offline schedule — a counsellor can give you exact batch timings and availability.",
} as const;

/** (5) Quiz-result follow-up. */
export const QUIZ = {
  greeting:
    "Nice work finishing that quiz — showing up and testing yourself is half the battle. Want to turn this into steady improvement?",
  askGoal: "What would help you most right now?",
  options: {
    weakAreas: "Fix my weak areas",
    testSeries: "Regular test practice",
    mentor: "Talk to a mentor",
  },
  weakAreas:
    "The fastest gains come from revising the exact topics you missed, then re-testing within a week. A structured programme builds this loop for you.",
  testSeries:
    "Regular, timed practice with proper feedback is what moves scores. Let me show you what's running, or connect you with a mentor to plan it.",
} as const;

/** (6) Payment-abandoned recovery. Uses REAL status; never says "failed". */
export const RECOVERY = {
  initiated:
    "Looks like you started enrolling but didn't finish — totally fine, it happens. Nothing's lost and your details are safe.",
  offerResume:
    "Whenever you're ready, you can pick up right where you left off. Want the link, or would you prefer a counsellor to help you complete it?",
  resumeLabel: "Resume enrolment",
  paidLine:
    "Good news — our records show this is already sorted, so there's nothing you need to do here.",
  statusNeutral:
    "Your enrolment isn't complete yet. No seat is confirmed until payment is done, so let's finish it properly when you're ready.",
  helpCta: "Have a counsellor help me finish",
  checkCta: "Check my enrolment status",
  checkTitle: "Check your status",
  checkSubtitle: "Enter the number you enrolled with — I'll only show your own status.",
  submitCheck: "Check status",
  allClear:
    "Good news — our records show your enrolment is already complete. Nothing pending on your side.",
  noneFound:
    "I couldn't find a pending enrolment for that number. If that seems off, a counsellor can look into it with you.",
} as const;

/** (7) Counselor handoff. */
export const HANDOFF = {
  intro:
    "Let's get you a real person. Share your name and number and a counsellor will reach out — honest guidance, no spam.",
  whatsappHint:
    "Prefer WhatsApp? You can also message the team directly.",
  submitted:
    "Done — a counsellor will get in touch with you soon. Meanwhile, feel free to explore free resources.",
  submittedNoConsent:
    "Thanks! To have a counsellor call you, I'll need your permission to be contacted first.",
} as const;

/** (8) Post-registration nurture. */
export const NURTURE = {
  greeting:
    "You're registered — nicely done. A little prep beforehand makes any session far more useful.",
  tips: "Want a quick checklist to get the most out of it?",
  checklistTitle: "Make the most of your session",
  checklist: {
    calendar: {
      title: "Block the time",
      detail: "Add it to your calendar and set a reminder so it doesn't slip.",
    },
    questions: {
      title: "Come with questions",
      detail: "Jot down 2–3 things you're stuck on — you'll get far more value.",
    },
    resources: {
      title: "Warm up first",
      detail: "Skim a relevant free resource beforehand so the session lands deeper.",
    },
  },
  outro: "Anything else I can help you prepare?",
} as const;

/** (9) Resource conversion. */
export const RESOURCE = {
  intro:
    "Plenty of solid, free material to get you moving. What are you looking for?",
  options: {
    browse: "Browse UPSC resources",
    currentAffairs: "Current affairs",
    plan: "Help me use them well",
  },
  browse:
    "Here's our free UPSC resource hub — start with the basics and build up from there.",
  browseLabel: "Open free resources",
  currentAffairs:
    "Daily current affairs is the habit that separates serious aspirants. Start today and keep it consistent.",
  planNudge:
    "Free resources are a great start. If you'd like structure and accountability around them, a counsellor can help you plan.",
} as const;

/** Consent explainer copy (shown before any phone capture, when required). */
export const CONSENT = {
  title: "Quick permission",
  body:
    "To have a counsellor reach out, I need your okay to contact you about your UPSC prep. We'll only use your details for that — no spam, and you can opt out anytime.",
  accept: "Yes, you can contact me",
  decline: "Not now",
} as const;

/** Lead-capture form copy. */
export const CAPTURE = {
  callbackTitle: "Talk to a counsellor",
  callbackSubtitle: "Share your details and we'll reach out personally.",
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
