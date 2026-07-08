/**
 * Seed the UPSC Resources hub with strong, original, SEO-optimized STARTER DRAFTS.
 *
 * - All items are saved as status='draft' (pending Naman Sir's review). Nothing is
 *   auto-published.
 * - Idempotent: an existing slug is skipped (never duplicated / never overwritten),
 *   unless you pass --force to overwrite the body/SEO of the matching draft.
 * - DRY-RUN by default. Pass --commit to actually write.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx scripts/seed-upsc-resources.ts            # dry-run
 *   node --env-file=.env.local --import tsx scripts/seed-upsc-resources.ts --commit   # write drafts
 *   node --env-file=.env.local --import tsx scripts/seed-upsc-resources.ts --commit --force  # overwrite existing
 *
 * Content is grounded in the official UPSC CSE notification (upsc.gov.in): Prelims
 * (GS Paper I + CSAT), Mains (9 papers incl. 2 qualifying language papers, Essay,
 * GS I–IV, 2 optional papers), eligibility, attempts and age limits. Exam-cycle
 * DATES change every year, so evergreen guides describe the structure, not fixed
 * dates.
 */
import { addResource, updateResource, getResources } from "../lib/dataProvider";
import { normalizeResourceInput } from "../lib/resourceNormalize";
import type { Resource } from "../lib/types";

const COMMIT = process.argv.includes("--commit");
const FORCE = process.argv.includes("--force");

type SeedItem = Partial<Resource>;

const CTA_WEBINAR = { kind: "webinar" as const, title: "Join Naman Sir's Live UPSC Beginners Masterclass", description: "A free live session to plan your UPSC journey the right way.", cta_label: "Register free", href: "/webinars", enabled: true };
const CTA_COURSE = { kind: "course" as const, title: "Start with the Safalta Foundation Batch", description: "Structured GS Foundation with mentorship by Naman Sir — online, offline & hybrid.", cta_label: "View courses", href: "/courses", enabled: true };
const CTA_QUIZ = { kind: "quiz" as const, title: "Attempt free UPSC MCQs", description: "Test yourself with prelims-style questions and build accuracy.", cta_label: "Start a quiz", href: "/quizzes", enabled: true };
const CTA_CENTRE = { kind: "centre" as const, title: "Visit our Sector-17 Chandigarh Centre", description: "Meet Naman Sir and our mentors in person and see a live class.", cta_label: "Get directions", href: "/contact", enabled: true };
const CTA_WHATSAPP = { kind: "whatsapp" as const, title: "Talk to our counsellor", description: "Have a question about batches, fees or your preparation? We're here to help.", cta_label: "Chat on WhatsApp", href: "/contact", enabled: true };

const SEEDS: SeedItem[] = [
  // ============================ GENERIC / EVERGREEN (journey order) ============================
  {
    slug: "upsc-beginners-guide",
    title: "Complete UPSC Beginner's Guide — How to Start from Zero (Day 1)",
    summary: "A step-by-step UPSC guide for absolute beginners: what the exam is, how the three stages work, how long it takes, and exactly what to do on Day 1.",
    category: "beginner",
    subject: "General",
    exam_relevance: "beginner",
    target_year: "evergreen",
    difficulty: "beginner",
    journey_stage: "Stage 1: Getting Started",
    order_index: 10,
    focus_keyword: "upsc preparation for beginners",
    tags: ["beginner", "getting-started", "strategy", "pending-review"],
    body_html: `
<p>If you are reading this, you have already taken the hardest step — deciding to attempt one of the toughest exams in the world. This guide is written for a complete beginner. No jargon, no false promises — just a clear, honest map of what UPSC preparation actually looks like and how to begin on Day 1.</p>
<h2>What is the UPSC Civil Services Examination?</h2>
<p>The Civil Services Examination (CSE) is conducted every year by the Union Public Service Commission (UPSC) to recruit officers for services such as the IAS, IPS and IFS. It is a single, three-stage process:</p>
<ul>
<li><strong>Prelims</strong> — an objective screening test (two papers).</li>
<li><strong>Mains</strong> — a written descriptive examination (nine papers).</li>
<li><strong>Interview</strong> — a personality test before a board.</li>
</ul>
<p>Only Prelims → Mains → Interview marks decide your final rank (Prelims marks are <em>not</em> added to the final tally — they only qualify you for Mains).</p>
<h2>Who can apply? (Eligibility in brief)</h2>
<ul>
<li><strong>Education:</strong> a graduate degree from a recognised university (final-year students can apply for Prelims).</li>
<li><strong>Age:</strong> generally 21–32 years for the General category on the cut-off date, with relaxations for reserved categories.</li>
<li><strong>Attempts:</strong> 6 for General/EWS, 9 for OBC, and unlimited (up to the age limit) for SC/ST; PwBD candidates get additional relaxations.</li>
</ul>
<p>Always confirm the exact numbers from the latest official notification on <strong>upsc.gov.in</strong> before you apply.</p>
<h2>How long does UPSC preparation take?</h2>
<p>For most sincere beginners, a first serious attempt needs roughly <strong>12–18 months</strong> of consistent study. What matters far more than raw hours is <em>consistency</em> — 6 focused hours a day, every day, beats 12 hours in bursts followed by weeks off.</p>
<h2>Your Day-1 checklist</h2>
<ol>
<li><strong>Download the official syllabus</strong> and read it once, fully. It is your single most important document.</li>
<li><strong>Start NCERTs</strong> (Classes 6–12) for History, Geography, Polity and Economy — they build your base.</li>
<li><strong>Begin a daily newspaper habit</strong> (The Hindu or Indian Express) for 45–60 minutes.</li>
<li><strong>Pick a stable source per subject</strong> and avoid hoarding books.</li>
<li><strong>Make revision non-negotiable</strong> — what you don't revise, you will forget.</li>
</ol>
<h2>The beginner mindset that actually wins</h2>
<p>UPSC rewards depth over speed and revision over collection. Do fewer resources, but revise them many times. Write answers early. Give mock tests without waiting to "finish the syllabus" — you never truly finish it; you get better at it.</p>
<h2>Follow the roadmap in order</h2>
<p>This guide is Stage 1 of our free <strong>Day 1 → Exam roadmap</strong>. Read the next guide on the exam pattern and syllabus, then move through books, timetable, prelims and mains in sequence.</p>
`,
    faq: [
      { q: "Can I prepare for UPSC while working or in college?", a: "Yes. Many aspirants clear the exam while working or studying. The key is a realistic, consistent daily routine (even 3–4 focused hours) and strict revision, rather than long unsustainable hours." },
      { q: "Do I need coaching to clear UPSC?", a: "Coaching is helpful for structure, mentorship and doubt-solving, but it is not mandatory. What is mandatory is the right sources, disciplined revision, answer writing and regular tests. Guidance simply makes the path shorter." },
      { q: "Which optional subject should a beginner choose?", a: "Do not rush this. First understand the GS papers. Choose your optional based on interest, background and availability of material — we cover this in a dedicated guide in the roadmap." },
    ],
    cta_blocks: [CTA_WEBINAR, CTA_COURSE],
    related: { resource_slugs: ["upsc-exam-pattern-syllabus", "best-books-for-upsc", "upsc-study-plan-for-beginners"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },
  {
    slug: "upsc-exam-pattern-syllabus",
    title: "UPSC Exam Pattern & Syllabus Explained (Prelims, Mains & Interview)",
    summary: "The complete UPSC CSE exam pattern and syllabus — Prelims (GS + CSAT), Mains (9 papers), and the Interview — with marks, papers and how the final rank is calculated.",
    category: "syllabus",
    subject: "General",
    exam_relevance: "all",
    target_year: "evergreen",
    difficulty: "beginner",
    journey_stage: "Stage 2: Understand the Exam",
    order_index: 20,
    focus_keyword: "upsc syllabus",
    tags: ["syllabus", "exam-pattern", "prelims", "mains", "pending-review"],
    body_html: `
<p>Before you study a single topic, you must understand the structure of the UPSC Civil Services Examination. This guide explains the exam pattern and syllabus exactly as laid out in the official UPSC notification, so you always know what you are preparing for.</p>
<h2>Stage 1 — Preliminary Examination (screening)</h2>
<p>Prelims has two objective (MCQ) papers of 200 marks each, two hours each:</p>
<table>
<thead><tr><th>Paper</th><th>Marks</th><th>Questions</th><th>Nature</th></tr></thead>
<tbody>
<tr><td>Paper I — General Studies</td><td>200</td><td>100</td><td>Merit (decides Mains cut-off)</td></tr>
<tr><td>Paper II — CSAT</td><td>200</td><td>80</td><td>Qualifying (minimum 33%)</td></tr>
</tbody>
</table>
<p>There is a negative marking of one-third of the marks for each wrong answer. CSAT is only qualifying — you must score at least 33%, but its marks do not count for the merit list. Only <strong>GS Paper I</strong> decides who advances to Mains.</p>
<h2>Stage 2 — Main Examination (written)</h2>
<p>Mains has nine descriptive papers. Two are qualifying language papers; the remaining seven count for your rank:</p>
<table>
<thead><tr><th>Paper</th><th>Marks</th><th>Counts for rank?</th></tr></thead>
<tbody>
<tr><td>Paper A — Indian Language</td><td>300</td><td>Qualifying only</td></tr>
<tr><td>Paper B — English</td><td>300</td><td>Qualifying only</td></tr>
<tr><td>Essay</td><td>250</td><td>Yes</td></tr>
<tr><td>GS Paper I</td><td>250</td><td>Yes</td></tr>
<tr><td>GS Paper II</td><td>250</td><td>Yes</td></tr>
<tr><td>GS Paper III</td><td>250</td><td>Yes</td></tr>
<tr><td>GS Paper IV (Ethics)</td><td>250</td><td>Yes</td></tr>
<tr><td>Optional Paper I</td><td>250</td><td>Yes</td></tr>
<tr><td>Optional Paper II</td><td>250</td><td>Yes</td></tr>
</tbody>
</table>
<p>The seven counted papers total <strong>1750 marks</strong>.</p>
<h3>What the GS papers cover</h3>
<ul>
<li><strong>GS I:</strong> Indian heritage & culture, history, society and geography (world & India).</li>
<li><strong>GS II:</strong> Polity, constitution, governance, social justice and international relations.</li>
<li><strong>GS III:</strong> Economy, science & technology, environment, disaster management and internal security.</li>
<li><strong>GS IV:</strong> Ethics, integrity and aptitude (includes case studies).</li>
</ul>
<h2>Stage 3 — Interview / Personality Test</h2>
<p>Candidates who clear Mains are called for a Personality Test of <strong>275 marks</strong>. The board assesses your clarity of thought, awareness, balance of judgement and suitability for a career in public service.</p>
<h2>How the final rank is calculated</h2>
<p>Your final merit = Mains (1750) + Interview (275) = <strong>2025 marks</strong>. Prelims marks are used only to shortlist for Mains and are not added to the final total.</p>
<h2>Eligibility, attempts and age (quick recap)</h2>
<ul>
<li>Graduate degree required; age broadly 21–32 for General (with category relaxations).</li>
<li>Attempts: General/EWS 6, OBC 9, SC/ST unlimited (till age limit), PwBD with relaxations.</li>
</ul>
<p>Exam <em>dates</em> change every cycle — always verify the current notification on upsc.gov.in.</p>
`,
    faq: [
      { q: "Is CSAT counted in the UPSC merit list?", a: "No. CSAT (Prelims Paper II) is only qualifying — you must score at least 33%, but its marks are not added to your merit. Only GS Paper I decides the Prelims cut-off." },
      { q: "How many papers are there in UPSC Mains?", a: "Nine papers: two qualifying language papers (Indian Language and English), plus Essay, four General Studies papers and two Optional papers. The last seven (1750 marks) count for your rank." },
      { q: "What is the total marks for the UPSC final merit?", a: "2025 marks — Mains (1750) plus the Interview/Personality Test (275). Prelims marks are not included in the final merit." },
    ],
    cta_blocks: [CTA_QUIZ, CTA_COURSE],
    related: { resource_slugs: ["upsc-beginners-guide", "best-books-for-upsc", "upsc-prelims-strategy", "upsc-optional-subject-selection"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },
  {
    slug: "best-books-for-upsc",
    title: "Best Books for UPSC (+ NCERT Strategy) — The Focused Booklist",
    summary: "A tight, no-nonsense UPSC booklist by subject, plus how to use NCERTs as your foundation. Fewer books, more revision — exactly what toppers actually follow.",
    category: "books",
    subject: "General",
    exam_relevance: "all",
    target_year: "evergreen",
    difficulty: "beginner",
    journey_stage: "Stage 3: Build the Foundation",
    order_index: 30,
    focus_keyword: "best books for upsc",
    tags: ["books", "ncert", "booklist", "pending-review"],
    body_html: `
<p>The biggest mistake beginners make is collecting too many books. UPSC does not reward how many books you own — it rewards how many times you revise a focused set. Here is a lean, reliable booklist along with an NCERT strategy that has stood the test of time.</p>
<h2>Start with NCERTs (your foundation)</h2>
<p>Read NCERTs of Classes 6–12 before touching advanced books. They build clarity in simple language:</p>
<ul>
<li><strong>History:</strong> Class 6–12 (Ancient, Medieval, Modern).</li>
<li><strong>Geography:</strong> Class 6–12.</li>
<li><strong>Polity:</strong> Class 9–12.</li>
<li><strong>Economy:</strong> Class 9–12.</li>
<li><strong>Science:</strong> Class 6–10 for basics.</li>
</ul>
<h2>Standard books by subject</h2>
<table>
<thead><tr><th>Subject</th><th>Recommended standard source</th></tr></thead>
<tbody>
<tr><td>Polity</td><td>Indian Polity by M. Laxmikanth</td></tr>
<tr><td>Modern History</td><td>A concise modern-history text (e.g., Spectrum-style)</td></tr>
<tr><td>Geography</td><td>NCERTs + a standard reference + Atlas</td></tr>
<tr><td>Economy</td><td>An introductory macroeconomics reader + government survey highlights</td></tr>
<tr><td>Environment</td><td>A focused environment & ecology book</td></tr>
<tr><td>Art & Culture</td><td>NCERT "An Introduction to Indian Art" + notes</td></tr>
<tr><td>Ethics (GS IV)</td><td>One standard ethics book + your own examples</td></tr>
</tbody>
</table>
<h2>The rule: one source per subject</h2>
<p>Choose one primary source per subject and stick to it. Supplement with current affairs and answer writing — not with a second and third book on the same topic. Revise your chosen source 4–5 times before the exam.</p>
<h2>Make your own notes (short and revisable)</h2>
<p>Convert your reading into crisp, revisable notes — bullet points, not paragraphs. Digital or physical, keep them short enough to revise a subject in a day close to the exam.</p>
<h2>Don't forget current affairs</h2>
<p>Books give you the static base; current affairs give you the edge. Pair this booklist with a daily newspaper and a monthly compilation.</p>
`,
    faq: [
      { q: "Are NCERTs enough for UPSC?", a: "NCERTs are essential but not sufficient on their own. They build your foundation; you then layer standard books, current affairs and answer writing on top. Skipping NCERTs, however, makes advanced study much harder." },
      { q: "How many books should I use per subject?", a: "Ideally one primary standard source per subject, revised multiple times, plus current affairs. Collecting many books on the same topic wastes time and reduces revision." },
      { q: "Should I make notes from books?", a: "Yes — short, bullet-point notes you can revise quickly. Notes are for revision, not for re-writing the book. Keep them concise." },
    ],
    cta_blocks: [CTA_COURSE, CTA_QUIZ],
    related: { resource_slugs: ["how-to-read-ncerts-for-upsc", "upsc-study-plan-for-beginners", "upsc-exam-pattern-syllabus"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },
  {
    slug: "upsc-study-plan-for-beginners",
    title: "UPSC Preparation Timetable & Study Plan for Beginners",
    summary: "A realistic UPSC study plan and daily timetable for beginners — how to split hours across static subjects, current affairs, revision and answer writing without burning out.",
    category: "strategy",
    subject: "General",
    exam_relevance: "all",
    target_year: "evergreen",
    difficulty: "beginner",
    journey_stage: "Stage 3: Build the Foundation",
    order_index: 40,
    focus_keyword: "upsc study plan",
    tags: ["timetable", "study-plan", "strategy", "pending-review"],
    body_html: `
<p>A good UPSC timetable is not about studying more — it is about studying the right things consistently. This plan is designed for a beginner who wants a sustainable routine, whether you have 6 hours or 10 hours a day.</p>
<h2>The four buckets of every study day</h2>
<ol>
<li><strong>Static subject</strong> (NCERT/standard book) — build the base.</li>
<li><strong>Current affairs</strong> — newspaper + notes.</li>
<li><strong>Revision</strong> — of what you studied in the previous days.</li>
<li><strong>Answer writing / MCQs</strong> — apply what you learn.</li>
</ol>
<h2>Sample daily timetable (beginner, ~7–8 hours)</h2>
<table>
<thead><tr><th>Time</th><th>Activity</th></tr></thead>
<tbody>
<tr><td>Morning (2.5 hrs)</td><td>Toughest static subject (fresh mind)</td></tr>
<tr><td>Late morning (1 hr)</td><td>Newspaper + current-affairs notes</td></tr>
<tr><td>Afternoon (2 hrs)</td><td>Second subject / optional</td></tr>
<tr><td>Evening (1 hr)</td><td>Revision of the last 3 days</td></tr>
<tr><td>Night (1–1.5 hrs)</td><td>Answer writing or MCQ practice</td></tr>
</tbody>
</table>
<h2>Weekly rhythm</h2>
<ul>
<li>6 days of study, with a lighter 7th day for full revision and one mock.</li>
<li>One weekly test (prelims MCQs or a couple of Mains answers).</li>
<li>Sunday: consolidate the week's current affairs into one page.</li>
</ul>
<h2>Phase-wise plan across the year</h2>
<ul>
<li><strong>Months 1–6:</strong> Finish NCERTs + one standard book per subject; start newspaper.</li>
<li><strong>Months 7–9:</strong> Deepen GS, begin optional, start answer writing.</li>
<li><strong>Months 10–12:</strong> Prelims focus — MCQ tests, revision, previous-year papers.</li>
<li><strong>Post-prelims:</strong> Full Mains mode — answer writing and test series.</li>
</ul>
<h2>Avoid burnout</h2>
<p>Sleep 7 hours, take short breaks, and protect one relaxed evening a week. A rested aspirant revises better than an exhausted one. Consistency over months beats intensity over days.</p>
`,
    faq: [
      { q: "How many hours should a beginner study for UPSC?", a: "Quality matters more than quantity. A focused 6–8 hours a day, sustained consistently, is more effective than 12 erratic hours. Build up gradually and protect your sleep." },
      { q: "Should I start answer writing as a beginner?", a: "Yes, start early with a few answers a week even if they feel imperfect. Answer writing is a skill built over months, not a switch you flip after finishing the syllabus." },
      { q: "How do I fit revision into my timetable?", a: "Reserve a fixed daily slot (about an hour) for revising the previous few days, and a weekly slot for the whole week. Un-revised material is effectively un-studied." },
    ],
    cta_blocks: [CTA_COURSE, CTA_WEBINAR],
    related: { resource_slugs: ["best-books-for-upsc", "upsc-prelims-strategy", "upsc-common-mistakes-beginners"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },
  {
    slug: "how-to-read-ncerts-for-upsc",
    title: "How to Read NCERTs for UPSC (The Right Way)",
    summary: "NCERTs are the foundation of UPSC prep — but only if read correctly. Learn which NCERTs to read, in what order, how to make notes, and how to link them to the syllabus.",
    category: "books",
    subject: "General",
    exam_relevance: "all",
    target_year: "evergreen",
    difficulty: "beginner",
    journey_stage: "Stage 3: Build the Foundation",
    order_index: 50,
    focus_keyword: "how to read ncert for upsc",
    tags: ["ncert", "books", "foundation", "pending-review"],
    body_html: `
<p>Everyone tells beginners to "read NCERTs" — but few explain <em>how</em>. Reading them like a school student is a waste of time; reading them like an aspirant builds a base you will use for years. Here is the method.</p>
<h2>Which NCERTs to read</h2>
<ul>
<li><strong>History:</strong> Classes 6–12 (themes in Indian history, modern India).</li>
<li><strong>Geography:</strong> Classes 6–12 (physical, human, Indian geography).</li>
<li><strong>Polity:</strong> Classes 9–12 (Indian Constitution at Work, Political Theory).</li>
<li><strong>Economy:</strong> Classes 9–12 (macroeconomics, Indian economic development).</li>
<li><strong>Science:</strong> Classes 6–10 for basics; Art & Culture NCERT for GS I.</li>
</ul>
<h2>In what order?</h2>
<p>Go class-wise within a subject (6 → 12), finishing one subject before moving to the next. This keeps concepts connected instead of scattered.</p>
<h2>How to actually read them</h2>
<ol>
<li><strong>First pass:</strong> read a chapter fully without highlighting — just understand.</li>
<li><strong>Second pass:</strong> underline only key terms, definitions and facts.</li>
<li><strong>Notes pass:</strong> convert the chapter into 8–12 bullet points in your own words.</li>
<li><strong>Link to syllabus:</strong> tag each note to the UPSC syllabus theme it belongs to.</li>
</ol>
<h2>Connect NCERTs to current affairs</h2>
<p>When a topic appears in the news (say, a river or an amendment), go back to the relevant NCERT concept. This "static + dynamic" linkage is what UPSC actually tests.</p>
<h2>How many times to revise</h2>
<p>Revise NCERT notes at least 2–3 times. Because they are short and clear, they are perfect for last-month revision when time is scarce.</p>
<h2>Common NCERT mistakes to avoid</h2>
<ul>
<li>Reading every line like an exam textbook — read for concepts, not memorisation.</li>
<li>Making notes that are as long as the chapter — keep them short.</li>
<li>Skipping older classes because they "feel basic" — they carry foundational facts.</li>
</ul>
`,
    faq: [
      { q: "From which class should I start reading NCERTs?", a: "Start from Class 6 within each subject and go up to Class 12. Older-class NCERTs carry foundational facts and simple explanations that make advanced books easier." },
      { q: "Should I make notes from NCERTs?", a: "Yes — short, bullet-point notes in your own words, tagged to the syllabus. These become gold during last-month revision because they are quick to read." },
      { q: "Are old NCERTs or new NCERTs better for UPSC?", a: "Both have value. The current NCERTs are the standard base; some aspirants supplement history with older editions. Do not over-optimise here — pick one set and revise it well." },
    ],
    cta_blocks: [CTA_COURSE, CTA_QUIZ],
    related: { resource_slugs: ["best-books-for-upsc", "upsc-study-plan-for-beginners", "upsc-beginners-guide"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },
  {
    slug: "upsc-prelims-strategy",
    title: "UPSC Prelims Strategy — How to Clear the Screening Test",
    summary: "A practical UPSC Prelims strategy: how to balance GS and CSAT, use previous-year papers, master elimination, and revise so you clear the cut-off with confidence.",
    category: "prelims",
    subject: "General",
    exam_relevance: "prelims",
    target_year: "evergreen",
    difficulty: "intermediate",
    journey_stage: "Stage 4: Prelims Preparation",
    order_index: 60,
    focus_keyword: "upsc prelims strategy",
    tags: ["prelims", "csat", "strategy", "pending-review"],
    body_html: `
<p>Prelims is a filter, not the finish line — but you cannot reach Mains without clearing it. The good news: Prelims is highly beatable with a disciplined strategy built on previous-year papers, elimination skill and relentless revision.</p>
<h2>Understand what Prelims tests</h2>
<p>GS Paper I (200 marks, 100 questions) decides your cut-off. CSAT (Paper II) is qualifying — you only need 33%. Never ignore CSAT, but invest most of your effort in GS.</p>
<h2>Previous-year papers are your compass</h2>
<p>Solve at least the last 8–10 years of Prelims papers early. They reveal the depth, pattern and favourite areas of UPSC — and stop you from over-reading unimportant topics.</p>
<h2>Master the art of elimination</h2>
<p>Many Prelims questions are cracked not by knowing the answer, but by eliminating wrong options. Practice identifying extreme words ("only", "always", "never"), factual mismatches and logically impossible statements.</p>
<h2>Smart guessing and negative marking</h2>
<p>With one-third negative marking, blind guessing hurts. But if you can eliminate two options, an educated guess is usually worth it. Build this judgement through mocks, not on exam day.</p>
<h2>The revision-and-test loop</h2>
<ol>
<li>Finish the static syllabus once.</li>
<li>Take a full-length mock every week in the final 3 months.</li>
<li>Analyse each mock — not just the score, but <em>why</em> you got questions wrong.</li>
<li>Revise weak areas and repeat.</li>
</ol>
<h2>Don't neglect CSAT</h2>
<p>If you are from a non-maths background, practice CSAT reasoning, comprehension and basic numeracy weekly. A few dozen hours of practice usually secures the 33% comfortably.</p>
<h2>Final month</h2>
<p>Stop new material. Revise notes, redo mistakes, and take timed tests. Confidence in Prelims comes from repetition, not last-minute additions.</p>
`,
    faq: [
      { q: "How many mock tests should I take for UPSC Prelims?", a: "Aim for at least 20–30 full-length mocks in the final months, with careful analysis after each. The analysis matters more than the number — understand every mistake." },
      { q: "Is CSAT difficult to qualify?", a: "For most, CSAT is manageable with weekly practice of comprehension, reasoning and basic numeracy. Non-maths candidates should not ignore it, since it is qualifying at 33%." },
      { q: "Should I guess in UPSC Prelims?", a: "Avoid blind guessing due to negative marking. But if you can confidently eliminate two options, an educated guess is generally worth the risk." },
    ],
    cta_blocks: [CTA_QUIZ, CTA_COURSE],
    related: { resource_slugs: ["upsc-exam-pattern-syllabus", "how-to-read-the-hindu-for-upsc", "upsc-study-plan-for-beginners"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },
  {
    slug: "how-to-read-the-hindu-for-upsc",
    title: "How to Read The Hindu Newspaper for UPSC (Without Wasting Time)",
    summary: "Newspaper reading makes or breaks current affairs. Learn how to read The Hindu (or Indian Express) for UPSC in 45–60 minutes, what to note, and what to skip.",
    category: "strategy",
    subject: "Current Affairs",
    exam_relevance: "all",
    target_year: "evergreen",
    difficulty: "beginner",
    journey_stage: "Stage 4: Prelims Preparation",
    order_index: 65,
    focus_keyword: "how to read the hindu for upsc",
    tags: ["current-affairs", "newspaper", "strategy", "pending-review"],
    body_html: `
<p>The newspaper is the backbone of current affairs — but beginners often spend three hours on it and remember nothing. The goal is to read <em>less</em> and retain <em>more</em>, linking news to the syllabus.</p>
<h2>Read the syllabus first, then the newspaper</h2>
<p>You cannot judge what is important until you know the syllabus. Keep it in mind so you instinctively pick up polity, economy, environment, IR and governance news — and skip the noise.</p>
<h2>What to read (and what to skip)</h2>
<ul>
<li><strong>Read:</strong> national news with policy angle, editorials, the economy page, international relations, government schemes, reports and indices.</li>
<li><strong>Skip:</strong> political blame-game, celebrity news, local crime, sports (unless a major national achievement), and stock-market tickers.</li>
</ul>
<h2>The 45–60 minute method</h2>
<ol>
<li>Scan headlines and mark relevant articles (5 min).</li>
<li>Read editorials for analysis and Mains points (20–25 min).</li>
<li>Note factual news for Prelims — schemes, terms, institutions (15 min).</li>
<li>Write crisp notes tagged to a syllabus theme (10 min).</li>
</ol>
<h2>Make issue-based notes, not date-based notes</h2>
<p>Instead of noting news day by day, maintain topic files (e.g., "monetary policy", "climate"). Add new points to the right file. At revision time, you read a complete story, not scattered clippings.</p>
<h2>Editorials for Mains, facts for Prelims</h2>
<p>Editorials give you arguments, examples and balanced views for Mains answers. Factual snippets (a new scheme, an index rank, an institution) are for Prelims. Train your eye to separate the two.</p>
<h2>Use a monthly compilation as backup</h2>
<p>Even with daily reading, revise with a monthly current-affairs compilation so nothing slips through. Consistency beats intensity here too.</p>
`,
    faq: [
      { q: "How long should I spend on the newspaper for UPSC?", a: "45–60 minutes is ideal once you are trained. Beginners may take longer initially, but should aim to cut down by reading selectively and making issue-based notes." },
      { q: "The Hindu or Indian Express — which is better for UPSC?", a: "Both are excellent. Pick one and stay consistent. What matters is your method of reading and note-making, not the masthead." },
      { q: "Should I read the whole newspaper?", a: "No. Read selectively using the syllabus as a filter. Skip political drama, sports and crime, and focus on policy, economy, environment, IR and governance." },
    ],
    cta_blocks: [CTA_QUIZ, CTA_COURSE],
    related: { resource_slugs: ["upsc-prelims-strategy", "upsc-mains-answer-writing", "upsc-study-plan-for-beginners"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },
  {
    slug: "upsc-mains-answer-writing",
    title: "UPSC Mains Answer Writing — A Beginner-to-Pro Guide",
    summary: "Answer writing decides your rank. Learn how to structure UPSC Mains answers (intro-body-conclusion), manage time, add value with diagrams and examples, and improve fast.",
    category: "mains",
    subject: "General",
    exam_relevance: "mains",
    target_year: "evergreen",
    difficulty: "intermediate",
    journey_stage: "Stage 5: Mains & Answer Writing",
    order_index: 70,
    focus_keyword: "upsc mains answer writing",
    tags: ["mains", "answer-writing", "strategy", "pending-review"],
    body_html: `
<p>Two candidates can know the same content and score very differently in Mains. The difference is answer writing — how you structure, present and finish your answer under time pressure. This skill is learnable, and it is where ranks are made.</p>
<h2>Understand the demand of the question</h2>
<p>Every question has a directive word — <em>discuss, examine, critically analyse, evaluate</em>. Read it carefully. "Critically analyse" wants both sides and a judgement; "discuss" wants a balanced exploration. Answering the wrong demand loses marks even with correct content.</p>
<h2>The intro-body-conclusion structure</h2>
<ol>
<li><strong>Introduction (2–3 lines):</strong> define the term or set context — no long build-up.</li>
<li><strong>Body:</strong> the core, ideally in points/sub-headings so it is easy to evaluate.</li>
<li><strong>Conclusion (2–3 lines):</strong> a forward-looking, balanced closing — a way ahead, not a summary of the intro.</li>
</ol>
<h2>Add value: examples, data, diagrams</h2>
<p>Support points with a committee report, a scheme, a constitutional article, or a simple diagram/flowchart. Value addition signals depth and lifts your answer above generic writing.</p>
<h2>Manage time and the word limit</h2>
<p>You get roughly 7–8 minutes for a 10-mark answer and about 150 words. Practice writing within this limit — an incomplete paper is the most common Mains mistake. Attempt every question.</p>
<h2>Get feedback and iterate</h2>
<p>Write, get it evaluated, and incorporate the feedback. One reviewed answer teaches more than ten unreviewed ones. Maintain a personal "improvement list" of recurring mistakes.</p>
<h2>Build a daily/weekly writing habit</h2>
<p>Start with 2–3 answers a day. Use previous-year questions. Over months, structure becomes second nature and your speed rises without loss of quality.</p>
<h2>Don't ignore Essay and Ethics</h2>
<p>The Essay (250) and GS IV Ethics (250) together carry 500 marks and are high-scoring with practice. Collect examples, quotes and case-study frameworks alongside GS.</p>
`,
    faq: [
      { q: "How do I start answer writing for UPSC Mains?", a: "Begin with previous-year questions, write 2–3 answers a day in the intro-body-conclusion format, and get them evaluated. Focus first on structure and directive words, then on content depth." },
      { q: "How many words should a 10-mark UPSC answer be?", a: "About 150 words in roughly 7–8 minutes. Practice within this limit so you can complete the full paper — leaving questions unattempted is a major score-killer." },
      { q: "How can I improve answer writing quickly?", a: "Get honest feedback and act on it. Maintain an improvement list of recurring errors, add value through examples and diagrams, and write consistently rather than in bursts." },
    ],
    cta_blocks: [CTA_COURSE, CTA_WEBINAR],
    related: { resource_slugs: ["upsc-exam-pattern-syllabus", "how-to-read-the-hindu-for-upsc", "upsc-optional-subject-selection"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },
  {
    slug: "upsc-optional-subject-selection",
    title: "UPSC Optional Subject Selection Guide — How to Choose Wisely",
    summary: "Your optional (2 papers, 500 marks) can make or break your rank. Learn how to choose a UPSC optional subject based on interest, background, overlap and material.",
    category: "optional",
    subject: "General",
    exam_relevance: "mains",
    target_year: "evergreen",
    difficulty: "intermediate",
    journey_stage: "Stage 5: Mains & Answer Writing",
    order_index: 75,
    focus_keyword: "upsc optional subject",
    tags: ["optional", "mains", "strategy", "pending-review"],
    body_html: `
<p>The optional subject carries 500 marks across two papers — enough to decide your rank. Yet many aspirants choose it hastily, based on trends or a friend's advice. Choose it deliberately, using the criteria below.</p>
<h2>The four criteria for choosing an optional</h2>
<ol>
<li><strong>Genuine interest:</strong> you will study this for many months — boredom is fatal.</li>
<li><strong>Your background:</strong> a graduation subject gives a head start (but is not compulsory).</li>
<li><strong>Overlap with GS:</strong> subjects like Geography, PSIR, Sociology and Public Administration overlap with GS and Essay, saving time.</li>
<li><strong>Availability of material and guidance:</strong> good books, notes, and mentors make preparation smoother.</li>
</ol>
<h2>Interest vs scoring — what matters more?</h2>
<p>Chase interest and manageability over "scoring trends". Every optional has produced toppers. A subject you enjoy and can revise well will out-score a "high-scoring" subject you dislike.</p>
<h2>Don't over-index on trends</h2>
<p>Scoring patterns shift year to year. Base your decision on the four criteria above, not on last year's toppers' choices.</p>
<h2>How to test a subject before committing</h2>
<ul>
<li>Read one standard book chapter and a few previous-year papers.</li>
<li>Write two sample answers — does the subject click?</li>
<li>Check that quality material and guidance exist.</li>
</ul>
<h2>After you choose</h2>
<p>Build a dedicated optional timetable slot, integrate it with GS overlap, and start answer writing early. Treat both optional papers as seriously as GS — they are half a GS-worth of marks.</p>
`,
    faq: [
      { q: "Should my UPSC optional be my graduation subject?", a: "It helps, but it is not mandatory. Many toppers pick optionals outside their degree. Prioritise genuine interest, availability of material, and overlap with GS." },
      { q: "Which is the best optional subject for UPSC?", a: "There is no single best optional. The best one for you balances interest, your background, GS overlap and good material. Every optional has produced top ranks." },
      { q: "When should I choose my optional?", a: "After you understand the GS papers and have tested a subject with sample reading and answers — typically in the early-to-middle phase of preparation, not on Day 1." },
    ],
    cta_blocks: [CTA_COURSE, CTA_WHATSAPP],
    related: { resource_slugs: ["upsc-mains-answer-writing", "upsc-exam-pattern-syllabus", "best-books-for-upsc"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },
  {
    slug: "upsc-common-mistakes-beginners",
    title: "Common Mistakes UPSC Beginners Make (& How Many Hours to Study)",
    summary: "Avoid the mistakes that cost beginners a year — book hoarding, no revision, no answer writing, and chasing hours. Plus, how many hours you really need to study for UPSC.",
    category: "strategy",
    subject: "General",
    exam_relevance: "beginner",
    target_year: "evergreen",
    difficulty: "beginner",
    journey_stage: "Stage 6: Revision & Test Practice",
    order_index: 80,
    focus_keyword: "upsc preparation mistakes",
    tags: ["mistakes", "strategy", "beginner", "pending-review"],
    body_html: `
<p>Most beginners don't fail because the exam is impossible — they fail because of avoidable mistakes in the first year. Learn from them now and save yourself an entire attempt.</p>
<h2>Mistake 1: Hoarding books and resources</h2>
<p>Collecting ten books per subject feels productive but destroys revision. Pick one source per subject and revise it many times.</p>
<h2>Mistake 2: Studying without revision</h2>
<p>Reading once and moving on means forgetting most of it. Build a daily and weekly revision habit from Day 1. Un-revised study is wasted study.</p>
<h2>Mistake 3: Delaying answer writing and mocks</h2>
<p>Waiting to "finish the syllabus" before writing answers or taking tests is a classic trap. Start both early, even imperfectly — they build exam temperament.</p>
<h2>Mistake 4: Ignoring the syllabus and previous-year papers</h2>
<p>Studying without the syllabus in front of you leads to over-reading unimportant topics. Previous-year papers tell you exactly how deep to go.</p>
<h2>Mistake 5: Chasing hours instead of consistency</h2>
<p>A sustainable 6–8 focused hours daily beats erratic 12-hour marathons. Which brings us to the most common question…</p>
<h2>How many hours should you study for UPSC?</h2>
<p>There is no magic number. Working aspirants clear it with 3–5 focused hours; full-time aspirants typically do 7–9. What matters is <strong>focused</strong> hours plus revision plus tests — not clock-watching. Track output (chapters revised, answers written), not just time.</p>
<h2>Mistake 6: Neglecting health and burning out</h2>
<p>Sleep, short breaks and one relaxed evening a week keep you sharp for the long haul. UPSC is a marathon; pace yourself.</p>
<h2>The fix: a simple, repeatable loop</h2>
<p>Study one source → make short notes → revise → write answers / MCQs → analyse → repeat. Do this consistently and you will be ahead of most aspirants.</p>
`,
    faq: [
      { q: "How many hours a day are needed to crack UPSC?", a: "There is no fixed number. Working aspirants manage with 3–5 focused hours; full-time aspirants often do 7–9. Focused hours plus revision and tests matter far more than total time." },
      { q: "What is the biggest mistake UPSC beginners make?", a: "Hoarding too many resources and skipping revision. Fewer sources revised many times, with regular answer writing and mocks, beats collecting material you never revise." },
      { q: "When should I start mock tests?", a: "Early — do not wait to finish the syllabus. Regular mocks and answer writing build exam temperament and reveal weak areas while there is still time to fix them." },
    ],
    cta_blocks: [CTA_QUIZ, CTA_WEBINAR],
    related: { resource_slugs: ["upsc-study-plan-for-beginners", "upsc-prelims-strategy", "upsc-beginners-guide"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },

  // ============================ LOCAL SEO PAGES ============================
  {
    slug: "best-upsc-coaching-in-chandigarh",
    title: "Best UPSC Coaching in Chandigarh — A Practical Guide for Aspirants",
    summary: "Looking for the best UPSC coaching in Chandigarh? Here's what to look for — faculty, mentorship, batch size, test series and results — and how Naman IAS Academy helps.",
    category: "local",
    subject: "General",
    exam_relevance: "all",
    target_year: "evergreen",
    difficulty: "beginner",
    is_local: true,
    order_index: 110,
    focus_keyword: "upsc coaching in chandigarh",
    tags: ["chandigarh", "coaching", "local", "pending-review"],
    body_html: `
<p>Chandigarh has become a serious hub for UPSC preparation, drawing aspirants from across Punjab, Haryana and Himachal. But with many options, how do you choose the right coaching? This guide explains what actually matters — and how <strong>Naman Sharma IAS Academy</strong> approaches it.</p>
<h2>What to look for in a UPSC coaching institute</h2>
<ul>
<li><strong>Faculty you can access:</strong> mentorship matters more than big classrooms.</li>
<li><strong>Reasonable batch size:</strong> smaller batches mean personal attention and answer feedback.</li>
<li><strong>Structured GS foundation:</strong> a clear syllabus-linked plan, not scattered lectures.</li>
<li><strong>Test series & answer evaluation:</strong> regular prelims mocks and Mains answer checking.</li>
<li><strong>Current affairs integration:</strong> daily/monthly compilations built into the schedule.</li>
</ul>
<h2>Online, offline or hybrid?</h2>
<p>Chandigarh aspirants increasingly want flexibility. A good academy offers offline classes for discipline and peer energy, plus online/recorded access for revision. Choose the mode that fits your routine and stay consistent.</p>
<h2>Why aspirants choose Naman IAS Academy</h2>
<ul>
<li>Personal mentorship by Naman Sir with a strong community following.</li>
<li>Structured Foundation batches (online, offline & hybrid).</li>
<li>Daily current affairs, MCQs, PYQs and answer-writing practice.</li>
<li>Small, focused batches for genuine attention.</li>
</ul>
<h2>Visit us in Sector 17, Chandigarh</h2>
<p>The best way to judge any academy is to see a class yourself. Visit our Sector-17 centre, meet the mentors, and get an honest assessment of your preparation plan.</p>
`,
    faq: [
      { q: "Which is the best UPSC coaching in Chandigarh?", a: "The 'best' depends on your needs — faculty access, batch size, test series and mode. Naman Sharma IAS Academy offers personal mentorship, structured foundation batches and integrated current affairs, online, offline and hybrid." },
      { q: "Does UPSC coaching in Chandigarh offer online classes?", a: "Yes. Naman IAS Academy offers online, offline and hybrid options so aspirants across Punjab, Haryana and Himachal can study with flexibility while keeping access to mentorship." },
      { q: "Where is Naman IAS Academy located?", a: "Our centre is in Sector 17, Chandigarh. You can visit to see a live class, meet mentors and discuss your preparation plan." },
    ],
    cta_blocks: [CTA_CENTRE, CTA_WEBINAR, CTA_WHATSAPP],
    related: { resource_slugs: ["upsc-coaching-sector-17-chandigarh", "online-vs-offline-upsc-coaching-chandigarh", "upsc-beginners-guide"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },
  {
    slug: "upsc-coaching-sector-17-chandigarh",
    title: "UPSC Coaching in Sector 17, Chandigarh — Naman IAS Academy",
    summary: "UPSC coaching in the heart of Chandigarh. Naman IAS Academy's Sector-17 centre offers foundation batches, mentorship, test series and daily current affairs.",
    category: "local",
    subject: "General",
    exam_relevance: "all",
    target_year: "evergreen",
    difficulty: "beginner",
    is_local: true,
    order_index: 115,
    focus_keyword: "upsc coaching sector 17 chandigarh",
    tags: ["chandigarh", "sector-17", "coaching", "local", "pending-review"],
    body_html: `
<p>Sector 17 is Chandigarh's central hub — well-connected, accessible and ideal for a serious study routine. Naman Sharma IAS Academy's centre here brings structured UPSC preparation right to the heart of the city.</p>
<h2>Why a Sector-17 location matters</h2>
<ul>
<li>Central and easy to reach from across Chandigarh, Mohali and Panchkula.</li>
<li>Well-connected by public transport.</li>
<li>A focused study environment with peer motivation.</li>
</ul>
<h2>What we offer at the centre</h2>
<ul>
<li><strong>Foundation batches</strong> covering the full GS syllabus, syllabus-linked and structured.</li>
<li><strong>Mentorship by Naman Sir</strong> — personal guidance, not just lectures.</li>
<li><strong>Test series</strong> — prelims mocks and Mains answer evaluation.</li>
<li><strong>Daily current affairs</strong>, MCQs and previous-year practice.</li>
<li><strong>Online & hybrid access</strong> so you never miss a class.</li>
</ul>
<h2>Who should join?</h2>
<p>Whether you are a fresh graduate starting from zero or a repeater looking for sharper strategy and feedback, the Sector-17 centre offers a plan suited to your stage.</p>
<h2>Come see a class</h2>
<p>Drop by our Sector-17 centre, meet the mentors, and get an honest read on your preparation. Seeing a class in person is the best way to decide.</p>
`,
    faq: [
      { q: "Where exactly is Naman IAS Academy in Chandigarh?", a: "Our centre is located in Sector 17, Chandigarh — a central, well-connected location accessible from Chandigarh, Mohali and Panchkula." },
      { q: "What courses are offered at the Sector-17 centre?", a: "Structured GS Foundation batches, mentorship by Naman Sir, prelims and Mains test series, and daily current affairs — available offline, online and hybrid." },
      { q: "Can I attend a demo class?", a: "Yes. You can visit the Sector-17 centre to see a live class, meet the mentors and discuss your preparation plan before enrolling." },
    ],
    cta_blocks: [CTA_CENTRE, CTA_COURSE, CTA_WHATSAPP],
    related: { resource_slugs: ["best-upsc-coaching-in-chandigarh", "online-vs-offline-upsc-coaching-chandigarh", "upsc-coaching-mohali-panchkula-tricity"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },
  {
    slug: "upsc-coaching-mohali-panchkula-tricity",
    title: "UPSC Coaching for Mohali, Panchkula & Tricity Students",
    summary: "Live in Mohali, Panchkula or the Tricity? Prepare for UPSC with Naman IAS Academy in nearby Sector-17 Chandigarh — plus online & hybrid options for zero commute.",
    category: "local",
    subject: "General",
    exam_relevance: "all",
    target_year: "evergreen",
    difficulty: "beginner",
    is_local: true,
    order_index: 120,
    focus_keyword: "upsc coaching mohali panchkula",
    tags: ["mohali", "panchkula", "tricity", "coaching", "local", "pending-review"],
    body_html: `
<p>The Tricity — Chandigarh, Mohali and Panchkula — is one integrated region for aspirants. If you live in Mohali, Panchkula, Zirakpur or nearby, you have easy access to serious UPSC preparation without moving to Delhi.</p>
<h2>Best of both worlds: offline access + online flexibility</h2>
<p>Our Sector-17 Chandigarh centre is a short commute from across the Tricity. And for days when travel isn't convenient, Naman IAS Academy offers online and hybrid access, so Mohali and Panchkula students never miss a class or a test.</p>
<h2>Why Tricity students choose Naman IAS Academy</h2>
<ul>
<li>Central Chandigarh location, easy from Mohali, Panchkula and Zirakpur.</li>
<li>Online & hybrid batches for zero-commute study days.</li>
<li>Personal mentorship, small batches and regular answer feedback.</li>
<li>Daily current affairs, MCQs and test series built in.</li>
</ul>
<h2>You don't need to move to Delhi</h2>
<p>Quality mentorship, structured content and disciplined test practice are now available right here in the Tricity. Save on relocation costs and study close to home with the same rigour.</p>
<h2>Talk to a counsellor</h2>
<p>Tell us where you're based and your target year — we'll suggest the right batch and mode (offline, online or hybrid) for your routine.</p>
`,
    faq: [
      { q: "Is there good UPSC coaching near Mohali and Panchkula?", a: "Yes. Naman IAS Academy's Sector-17 Chandigarh centre is a short commute from Mohali, Panchkula and Zirakpur, and also offers online and hybrid batches for zero-commute study." },
      { q: "Can Mohali/Panchkula students attend online?", a: "Absolutely. We offer online and hybrid options so Tricity students can access live classes, mentorship and test series without daily travel." },
      { q: "Do I need to move to Delhi for UPSC coaching?", a: "No. The Tricity now offers structured mentorship, content and test practice comparable to metro coaching — you can prepare seriously while staying close to home." },
    ],
    cta_blocks: [CTA_WHATSAPP, CTA_CENTRE, CTA_COURSE],
    related: { resource_slugs: ["best-upsc-coaching-in-chandigarh", "upsc-coaching-sector-17-chandigarh", "online-vs-offline-upsc-coaching-chandigarh"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },
  {
    slug: "upsc-coaching-for-himachal-students",
    title: "UPSC Coaching for Himachal Students — Prepare from Chandigarh or Online",
    summary: "Himachal Pradesh aspirants can prepare for UPSC with Naman IAS Academy — offline at our Chandigarh centre or fully online, with mentorship, tests and current affairs.",
    category: "local",
    subject: "General",
    exam_relevance: "all",
    target_year: "evergreen",
    difficulty: "beginner",
    is_local: true,
    order_index: 125,
    focus_keyword: "upsc coaching himachal",
    tags: ["himachal", "coaching", "online", "local", "pending-review"],
    body_html: `
<p>Aspirants from Himachal Pradesh often face a choice: relocate to a metro, or compromise on guidance. There is a better option — study with Naman IAS Academy from Chandigarh (the nearest major hub) or fully online, without leaving home.</p>
<h2>Chandigarh: the natural hub for Himachal aspirants</h2>
<p>Chandigarh is the closest well-connected city for most of Himachal. Our Sector-17 centre offers offline foundation batches for those who can relocate or commute, with the discipline and peer energy of a classroom.</p>
<h2>Prefer to study from home? Go online</h2>
<p>If relocating isn't practical, our online and hybrid batches bring the same mentorship, structured content, test series and current affairs to your screen — ideal for aspirants in Shimla, Solan, Mandi, Kangra and beyond.</p>
<h2>What you get either way</h2>
<ul>
<li>Structured GS Foundation aligned to the official syllabus.</li>
<li>Personal mentorship by Naman Sir and small-batch attention.</li>
<li>Prelims mocks, Mains answer evaluation and previous-year practice.</li>
<li>Daily and monthly current affairs.</li>
</ul>
<h2>Plan your preparation</h2>
<p>Tell us your location and target year, and we'll recommend the right mode and batch — so distance is never a barrier to a strong UPSC preparation.</p>
`,
    faq: [
      { q: "Can Himachal students prepare for UPSC without relocating?", a: "Yes. Naman IAS Academy offers fully online and hybrid batches with mentorship, test series and current affairs, so aspirants across Himachal can prepare from home." },
      { q: "Is Chandigarh a good option for Himachal UPSC aspirants?", a: "Chandigarh is the nearest well-connected hub for most of Himachal. Our Sector-17 centre offers offline foundation batches with classroom discipline and peer energy." },
      { q: "Will online coaching be as effective as offline?", a: "With discipline, yes. Our online batches include live classes, answer evaluation and tests. Many aspirants succeed online; the key is consistency and using the feedback provided." },
    ],
    cta_blocks: [CTA_WHATSAPP, CTA_WEBINAR, CTA_COURSE],
    related: { resource_slugs: ["online-vs-offline-upsc-coaching-chandigarh", "best-upsc-coaching-in-chandigarh", "upsc-beginners-guide"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },
  {
    slug: "online-vs-offline-upsc-coaching-chandigarh",
    title: "Online vs Offline UPSC Coaching in Chandigarh — Which Is Right for You?",
    summary: "Confused between online and offline UPSC coaching in Chandigarh? Compare cost, discipline, mentorship, flexibility and results — and find the mode that fits you.",
    category: "local",
    subject: "General",
    exam_relevance: "all",
    target_year: "evergreen",
    difficulty: "beginner",
    is_local: true,
    order_index: 130,
    focus_keyword: "online vs offline upsc coaching",
    tags: ["online", "offline", "chandigarh", "coaching", "local", "pending-review"],
    body_html: `
<p>Should you join online or offline UPSC coaching in Chandigarh? Both work — the right choice depends on your discipline, routine and learning style. Here's an honest comparison to help you decide.</p>
<h2>Quick comparison</h2>
<table>
<thead><tr><th>Factor</th><th>Offline</th><th>Online</th></tr></thead>
<tbody>
<tr><td>Discipline & routine</td><td>Stronger (fixed schedule, peer pressure)</td><td>Needs self-discipline</td></tr>
<tr><td>Flexibility</td><td>Lower (fixed timing/location)</td><td>Higher (study anywhere, replays)</td></tr>
<tr><td>Cost</td><td>Higher (travel/relocation)</td><td>Usually lower</td></tr>
<tr><td>Doubt-solving</td><td>Immediate, in person</td><td>Via live sessions/chat</td></tr>
<tr><td>Peer network</td><td>Strong</td><td>Moderate</td></tr>
<tr><td>Revision</td><td>Notes-based</td><td>Recorded lectures help</td></tr>
</tbody>
</table>
<h2>Choose offline if…</h2>
<ul>
<li>You study better with a fixed routine and classroom discipline.</li>
<li>You value in-person mentorship and a peer group.</li>
<li>You can commute to or relocate near the Sector-17 centre.</li>
</ul>
<h2>Choose online if…</h2>
<ul>
<li>You are self-disciplined and want flexibility.</li>
<li>You are outside Chandigarh (Tricity, Himachal, elsewhere).</li>
<li>You want to revise via recorded lectures.</li>
</ul>
<h2>Why hybrid is often the best answer</h2>
<p>Many aspirants thrive on a hybrid model — offline for core classes and discipline, online for revision and flexibility. Naman IAS Academy offers all three modes, so you can pick what suits your life without compromising on mentorship or tests.</p>
<h2>Still unsure?</h2>
<p>Talk to our counsellor about your routine and target year. We'll recommend the mode that maximises your consistency — which, in the end, is what clears UPSC.</p>
`,
    faq: [
      { q: "Is online UPSC coaching as good as offline?", a: "For self-disciplined aspirants, yes. Online offers flexibility and recorded revision; offline offers routine and in-person mentorship. Many succeed with a hybrid of both." },
      { q: "Which is cheaper — online or offline UPSC coaching?", a: "Online is usually more affordable since it avoids travel and relocation costs. Offline may cost more but adds classroom discipline and a peer network." },
      { q: "Does Naman IAS Academy offer both online and offline?", a: "Yes — online, offline and hybrid modes, so you can choose the one that best fits your routine while keeping mentorship, test series and current affairs." },
    ],
    cta_blocks: [CTA_WHATSAPP, CTA_COURSE, CTA_CENTRE],
    related: { resource_slugs: ["best-upsc-coaching-in-chandigarh", "upsc-coaching-for-himachal-students", "upsc-coaching-mohali-panchkula-tricity"] },
    seo: { structured_data_enabled: true, faq_schema_enabled: true },
  },
];

async function main() {
  console.log(`\n=== UPSC Resources seed — ${COMMIT ? "COMMIT" : "DRY-RUN"}${FORCE ? " (force overwrite)" : ""} ===`);
  console.log(`Total seed drafts: ${SEEDS.length}\n`);

  const existing = await getResources();
  const bySlug = new Map(existing.map((r) => [r.slug, r]));

  let created = 0, updated = 0, skipped = 0, failed = 0;

  for (const item of SEEDS) {
    const slug = item.slug!;
    const found = bySlug.get(slug);
    const payload = { ...item, status: "draft" as const, author: "Naman Sir" };
    const norm = normalizeResourceInput(payload as Record<string, unknown>);
    if (!norm.ok) { console.log(`  ✗ ${slug} — normalize error: ${norm.error}`); failed++; continue; }

    if (found && !FORCE) {
      console.log(`  ⏭  ${slug} — exists, skipped`);
      skipped++;
      continue;
    }

    if (!COMMIT) {
      console.log(`  ${found ? "↻ would update" : "＋ would create"}: ${slug}  (${item.title})`);
      found ? updated++ : created++;
      continue;
    }

    try {
      if (found) {
        await updateResource(found.id, norm.value as Partial<Resource>);
        console.log(`  ↻ updated: ${slug}`);
        updated++;
      } else {
        await addResource(norm.value as Partial<Resource>);
        console.log(`  ＋ created: ${slug}`);
        created++;
      }
    } catch (e) {
      console.log(`  ✗ ${slug} — ${e instanceof Error ? e.message : "failed"}`);
      failed++;
    }
  }

  console.log(`\nSummary: created=${created} updated=${updated} skipped=${skipped} failed=${failed}`);
  if (!COMMIT) console.log("Dry-run only. Re-run with --commit to write these drafts.\n");
  else console.log("Done. All items are DRAFTS — review & publish from /admin/resources.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
