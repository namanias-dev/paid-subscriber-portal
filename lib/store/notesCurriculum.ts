export interface NotesCurriculumLink {
  topic: string;
  current: string;
}

export interface NotesCurriculumGroup {
  title: string;
  items: string[];
}

export interface NotesCurriculumPoint {
  title: string;
  body: string;
}

export interface NotesCurriculum {
  slug: string;
  title: string;
  seoTitle: string;
  seoDescription: string;
  subheading: string;
  mentorIntro: string;
  why: string;
  whyTitle?: string;
  whyPoints?: NotesCurriculumPoint[];
  positioningTitle?: string;
  coverageTitle?: string;
  prelimsTitle?: string;
  prelimsIntro?: string;
  prelimsItems?: string[];
  mainsTitle?: string;
  mainsIntro?: string;
  mainsItems?: string[];
  coverage: NotesCurriculumGroup[];
  staticCurrentIntro: string;
  staticCurrent: NotesCurriculumLink[];
  staticCurrentNote?: string;
  howToUse: string[];
  referenceNote?: string;
}

const HOW_TO_USE = [
  "Read the core topic until the idea is clear.",
  "Link it with the relevant current development — a judgment, a Bill, a Budget number, or an anniversary.",
  "Mark PYQ-relevant concepts instead of highlighting everything.",
  "Revise the condensed notes repeatedly in the weeks before the paper.",
  "Add only essential updates. Do not rebuild the notes from scratch.",
];

export const NOTES_CURRICULUM: Record<string, NotesCurriculum> = {
  polity: {
    slug: "polity",
    title: "Indian Polity Notes",
    seoTitle: "Indian Polity Notes for UPSC | Naman Sir",
    seoDescription:
      "Handwritten Indian Polity notes for UPSC Prelims and Mains — Constitution, governance and institutions, connected to current affairs. Printed hard copies delivered pan-India.",
    subheading:
      "Naman Sir’s complete handwritten Polity notes — full UPSC syllabus with static concepts + integrated current affairs for Prelims & Mains.",
    mentorIntro:
      "Polity is one of the most consistent areas of UPSC preparation because the Constitution and institutions form the static base, while judgments, legislation, governance issues and institutional developments keep the subject current.",
    why: "UPSC returns to the same constitutional grammar every year: rights, federalism, Parliament, the executive and the courts. Once those structures are clear, current affairs stop feeling like a separate subject.",
    coverage: [
      {
        title: "Constitutional foundation",
        items: [
          "Historical background and making of the Constitution",
          "Salient features, Preamble, Union and citizenship",
          "Amendment procedure and the basic-structure doctrine",
        ],
      },
      {
        title: "Rights and constitutional values",
        items: ["Fundamental Rights", "Directive Principles of State Policy", "Fundamental Duties"],
      },
      {
        title: "System of government",
        items: [
          "Parliamentary system",
          "Federal structure and Centre–State relations",
          "Inter-State relations and emergency provisions",
        ],
      },
      {
        title: "Union executive and legislature",
        items: [
          "President, Vice-President, Prime Minister and Council of Ministers",
          "Parliament: composition, functions, privileges",
          "Parliamentary committees",
        ],
      },
      {
        title: "Judiciary",
        items: ["Supreme Court and High Courts", "Judicial review and judicial activism", "Public Interest Litigation"],
      },
      {
        title: "State and local government",
        items: ["Governor, Chief Minister and State Legislature", "Panchayati Raj", "Municipalities"],
      },
      {
        title: "Constitutional and statutory institutions",
        items: [
          "Election Commission, UPSC, Finance Commission, CAG",
          "Attorney General and other key offices",
          "Important commissions and bodies that UPSC actually asks",
        ],
      },
      {
        title: "Governance and current affairs",
        items: [
          "Important constitutional judgments",
          "Major legislation and institutional change",
          "Federal disputes, rights issues and governance debates",
        ],
      },
    ],
    staticCurrentIntro:
      "A constitutional topic rarely stays only static in UPSC. Parliament, Supreme Court judgments, federal issues, appointments, new laws and governance debates often turn core concepts into current-affairs questions.",
    staticCurrent: [
      { topic: "Fundamental Rights", current: "Important judgments and rights controversies" },
      { topic: "Parliament", current: "Bills, committees, privileges and procedure" },
      { topic: "Federalism", current: "Centre–State disputes and institutional friction" },
      { topic: "Constitutional bodies", current: "Appointments, powers and reforms" },
    ],
    howToUse: HOW_TO_USE,
    referenceNote:
      "Use these notes alongside standard references such as M. Laxmikanth for deeper reading where required. They are UPSC-oriented classroom notes, not a reproduction of any textbook.",
  },
  "modern-history": {
    slug: "modern-history",
    title: "Modern History Notes",
    seoTitle: "Modern History Handwritten Notes for UPSC | Naman Sharma IAS Academy",
    seoDescription:
      "Handwritten Modern History notes for UPSC CSE — chronology, movements and the freedom struggle, written for Prelims and Mains GS Paper I by Naman Sharma IAS Academy.",
    subheading:
      "Naman Sir’s handwritten Modern History notes for UPSC Prelims + Mains — structured around chronology, movements, personalities, Acts and the evolution of India’s freedom struggle.",
    mentorIntro:
      "Modern History may look finite, but UPSC does not reward a pile of isolated facts. Aspirants have to hold chronology, causes and consequences, personalities, movements, British policies, Acts and constitutional developments, socio-religious reforms, tribal and peasant movements, the economic impact of colonial rule, the growth of nationalism, Congress phases, revolutionary nationalism, Gandhian movements, Subhas Chandra Bose and the INA, and the developments that led to independence — as one connected story.",
    positioningTitle: "Modern History Is Not a Subject You Can Prepare Randomly",
    why: "Scattered PDFs and random notes make revision harder because the same event has to be recalled as a date in Prelims and as a cause, evolution or consequence in Mains. One coherent handwritten source keeps that story in one place.",
    whyTitle: "Why Naman Sir’s Handwritten Modern History Notes?",
    whyPoints: [
      {
        title: "Chronology That Actually Makes Sense",
        body: "Understand the sequence of events rather than memorising isolated dates.",
      },
      {
        title: "Built for Prelims + Mains",
        body: "Objective facts sit beside the context needed for GS Paper I.",
      },
      {
        title: "Movements, Acts & Personalities Connected",
        body: "Learn historical developments as connected stories rather than separate facts.",
      },
      {
        title: "Faster Revision",
        body: "Reduce dependence on dozens of scattered PDFs and resources.",
      },
      {
        title: "Exam-Oriented Structure",
        body: "Make large Modern History content easier to retain and revisit.",
      },
      {
        title: "Handwritten by Naman Sir",
        body: "Human-created, classroom-structured notes — not a compiled dump of source books.",
      },
    ],
    coverageTitle: "Inside the Notes",
    prelimsTitle: "For Prelims",
    prelimsIntro:
      "Prelims rewards command over chronology, organisations, personalities, Acts, movements and factual distinctions — and the ability to revise them quickly.",
    prelimsItems: [
      "Chronology and sequence of major events",
      "Acts and constitutional developments",
      "Personalities and organisations",
      "Congress sessions and phases",
      "Movements and their associations",
      "Fact differentiation that UPSC actually tests",
      "A revision structure you can return to",
    ],
    mainsTitle: "For Mains GS-I",
    mainsIntro:
      "The same topics have to become structured understanding: why something rose, how it evolved, what it changed, and how to write that with comparison and context.",
    mainsItems: [
      "Causes, consequences and significance",
      "Historical evolution rather than isolated episodes",
      "Colonial policy and its after-effects",
      "Growth and phases of nationalism",
      "Comparisons across movements and leadership",
      "Structured context for GS Paper I answers",
    ],
    coverage: [
      {
        title: "Decline of Mughal power and regional states",
        items: [
          "The late-Mughal setting and the rise of regional powers",
          "How the political map of eighteenth-century India opened the way for European expansion",
        ],
      },
      {
        title: "European expansion and British conquest",
        items: [
          "Arrival and rivalry of European powers",
          "British conquest and consolidation",
          "Company to Crown: administration after 1858",
        ],
      },
      {
        title: "British administration and economic impact",
        items: [
          "Administrative structure under colonial rule",
          "Revenue systems",
          "Economic impact of colonial rule",
        ],
      },
      {
        title: "Resistance to colonial rule",
        items: [
          "Early resistance, tribal and peasant movements",
          "Revolt of 1857 — causes, course and consequences",
        ],
      },
      {
        title: "Social and religious reform",
        items: ["Major socio-religious reform movements", "Key reformers", "Social change and its political afterlife"],
      },
      {
        title: "Growth of nationalism",
        items: [
          "Political associations and the Indian National Congress",
          "Moderates and Extremists",
          "Swadeshi movement and related developments",
        ],
      },
      {
        title: "Revolutionary nationalism and the Gandhian era",
        items: [
          "Revolutionary nationalism",
          "Gandhi’s early movements, Non-Cooperation, Civil Disobedience and Quit India",
          "Subhas Chandra Bose and the INA",
        ],
      },
      {
        title: "Constitutional developments and Independence",
        items: [
          "Major Acts and constitutional developments",
          "Negotiations, Partition and independence",
        ],
      },
    ],
    staticCurrentIntro:
      "Anniversaries, personalities, heritage sites and historical debates regularly bring static themes back into the news cycle. The notes keep the story ready so those moments do not become a new chapter to memorise.",
    staticCurrent: [
      { topic: "1857 and early resistance", current: "Commemorations, sites and historiographical debates" },
      { topic: "National movement", current: "Anniversaries of movements, leaders and organisations" },
      { topic: "Reform and society", current: "Social-reform commemorations and contemporary echoes" },
      { topic: "Independence and Partition", current: "Heritage, memory and constitutional beginnings" },
    ],
    howToUse: HOW_TO_USE,
  },
  economy: {
    slug: "economy",
    title: "Indian Economy Notes",
    seoTitle: "Indian Economy Notes for UPSC | Naman Sir",
    seoDescription:
      "Handwritten Indian Economy notes for UPSC — growth, inflation, banking, Budget and development, linked to current policy. Printed hard copies delivered pan-India.",
    subheading:
      "Naman Sir’s complete handwritten Economy notes — full UPSC syllabus with core concepts + current economic developments for Prelims & Mains.",
    mentorIntro:
      "Economy is easier when concepts are connected to real developments. UPSC can test the same idea as a definition in Prelims, a policy development in current affairs, and an analytical question in Mains.",
    why: "The paper rewards students who can move from a definition to a live number or a policy choice. These notes keep the concept short and leave room to attach the latest Survey, Budget or RBI decision.",
    coverage: [
      {
        title: "Economic foundations",
        items: [
          "Basic economic concepts and national income",
          "GDP / GVA, growth versus development",
          "Inflation and business cycles",
        ],
      },
      {
        title: "Indian economic development",
        items: ["Planning", "Reforms and liberalisation", "Structural change in the Indian economy"],
      },
      {
        title: "Agriculture",
        items: [
          "Agriculture and food management",
          "MSP and procurement concepts, food security and subsidies",
          "Agricultural reforms as UPSC frames them",
        ],
      },
      {
        title: "Industry and infrastructure",
        items: ["Industrial policy, manufacturing and MSMEs", "Infrastructure", "Services sector"],
      },
      {
        title: "Money, banking and finance",
        items: [
          "RBI and monetary policy",
          "Banking system and financial markets",
          "Insurance and securities markets",
        ],
      },
      {
        title: "Public finance",
        items: ["Taxation and fiscal policy", "Deficits, government expenditure and public debt"],
      },
      {
        title: "External sector",
        items: [
          "Balance of payments and exchange rates",
          "Trade and foreign investment",
          "International economic institutions",
        ],
      },
      {
        title: "Development",
        items: ["Poverty, inequality and employment", "Inclusion and human development", "Demographic issues"],
      },
      {
        title: "Environment and the economy",
        items: ["Sustainability", "Climate–economy linkages that appear in the paper"],
      },
      {
        title: "Current economic context",
        items: [
          "How to read the Economic Survey and the Union Budget",
          "RBI policy and major schemes or reforms",
          "Current macroeconomic developments — without stale statistics printed as if they were permanent",
        ],
      },
    ],
    staticCurrentIntro:
      "Do not treat a printed figure as the last word. Use the notes for the concept, then attach the latest official release.",
    staticCurrent: [
      { topic: "Inflation", current: "CPI / WPI readings and RBI policy" },
      { topic: "Fiscal policy", current: "Union Budget and deficit arithmetic" },
      { topic: "Banking", current: "RBI regulations and financial-sector developments" },
      { topic: "External sector", current: "Rupee, trade and the balance of payments" },
      { topic: "Growth", current: "GDP releases and the Economic Survey" },
    ],
    staticCurrentNote: "Figures change. The notes teach the idea; current documents supply this year’s numbers.",
    howToUse: HOW_TO_USE,
  },
};

export function getNotesCurriculum(slug: string): NotesCurriculum | null {
  return NOTES_CURRICULUM[slug] || null;
}
