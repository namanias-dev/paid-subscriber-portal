/**
 * Replace the body/SEO of the `upsc-beginners-guide` draft with Naman Sir's
 * reviewed long-form version. Keeps status='draft' (pending review), and leaves
 * journey placement, category, CTA blocks and related links untouched.
 *
 * DRY-RUN by default. Pass --commit to actually write.
 *
 *   node --env-file=.env.local --import tsx scripts/update-beginners-guide.ts           # dry-run
 *   node --env-file=.env.local --import tsx scripts/update-beginners-guide.ts --commit  # write
 */
import { getResourceBySlug, updateResource } from "../lib/dataProvider";
import { normalizeResourceInput } from "../lib/resourceNormalize";
import type { CaSeo } from "../lib/types";

const COMMIT = process.argv.includes("--commit");
const SLUG = "upsc-beginners-guide";

const TITLE = "UPSC Preparation for Beginners: The Complete Day-1 Roadmap";
const SUMMARY =
  "Start UPSC the right way. A step-by-step Day-1 roadmap from Naman Sir — exam structure, syllabus mastery, NCERTs, booklist, timetable, answer writing, and the mistakes that cost beginners an entire year.";
const AUTHOR = "Faculty Team, Naman Sharma IAS Academy (pending review)";
const FOCUS = "UPSC preparation for beginners";
const SECONDARY = [
  "how to start UPSC preparation",
  "UPSC roadmap for beginners",
  "UPSC study plan",
  "UPSC booklist",
  "IAS preparation from zero",
];

const BODY_HTML = `
<p>Most beginners don't fail UPSC because they aren't intelligent enough. They fail because they spend their <strong>first six months preparing to prepare</strong> — collecting booklists, downloading PDFs, watching "strategy" videos — without ever building the one thing that actually clears this exam: a system.</p>
<p>This guide fixes that. By the end, you will know exactly what to study, in what order, from which book, and how to measure whether you're on track — the same first-90-days framework we use with our foundation students. No fluff, no motivation-only talk. A plan you can start <strong>today</strong>.</p>
<blockquote><p><strong>Who this is for:</strong> Anyone starting from zero — a college student, a fresher, or a working professional targeting UPSC CSE 2027, 2028 or 2029. If you've never opened an NCERT for UPSC, you're in exactly the right place.</p></blockquote>

<h2>Key Takeaways (Read This First)</h2>
<ul>
<li>UPSC is a <strong>3-stage exam</strong>: Prelims → Mains → Personality Test (Interview). You clear them in that order, in the same cycle.</li>
<li>Your <strong>first 90 days</strong> should build a foundation (NCERTs + syllabus mastery + newspaper habit) — <em>not</em> advanced books.</li>
<li><strong>Limited sources, revised many times</strong> beats "more books." This single rule separates selected candidates from perpetual aspirants.</li>
<li><strong>Answer writing and current affairs start early</strong> — not in the final months.</li>
<li>Pick your <strong>optional subject deliberately</strong>, not emotionally. It's ~500 marks; it can make or break your rank.</li>
<li>Consistency of <strong>6–8 focused hours</strong> for 12–18 months beats 14 chaotic hours for a month.</li>
</ul>

<h2>Step 1 — Understand the Battlefield Before You Fight</h2>
<p>You cannot prepare for an exam you don't understand. The UPSC Civil Services Examination has <strong>three stages</strong>:</p>
<table><thead><tr><th>Stage</th><th>Purpose</th><th>Nature</th><th>Counts toward final rank?</th></tr></thead><tbody>
<tr><td><strong>Prelims</strong></td><td>Screening test</td><td>Objective (MCQ)</td><td>No — qualifying only</td></tr>
<tr><td><strong>Mains</strong></td><td>The real exam</td><td>Descriptive (written)</td><td>Yes</td></tr>
<tr><td><strong>Interview / Personality Test</strong></td><td>Final assessment</td><td>Face-to-face</td><td>Yes</td></tr>
</tbody></table>
<p>The single most important thing a beginner must internalise: <strong>Prelims marks do not count in your final rank.</strong> Prelims only decides <em>who gets to write Mains</em>. Your rank is built almost entirely in <strong>Mains + Interview</strong>. That's why smart aspirants build Mains-level understanding from Day 1 — and let Prelims fall out of it — rather than the other way around.</p>
<h3>The Prelims structure</h3>
<ul>
<li><strong>Paper I – General Studies (GS):</strong> 100 questions, 200 marks. This decides your cut-off.</li>
<li><strong>Paper II – CSAT:</strong> aptitude/comprehension/reasoning, and it is <strong>qualifying</strong> — you only need 33%. Do not ignore it, but don't over-invest either.</li>
</ul>
<h3>The Mains structure</h3>
<p>Mains has <strong>nine papers</strong>. Two are qualifying (a compulsory Indian language + English), and <strong>seven count</strong> toward your merit: Essay, four General Studies papers (GS-I to GS-IV, where GS-IV is Ethics), and <strong>two Optional subject papers</strong>. The Personality Test carries <strong>275 marks</strong>.</p>
<blockquote><p>⚠️ <strong>Exact dates and vacancies for the ongoing cycle change every year.</strong> For the current notification dates, exam schedule, age limits, number of attempts and vacancies, always rely on the official UPSC notification at upsc.gov.in.</p></blockquote>
<p><strong>Action for today:</strong> Download the official UPSC syllabus PDF from upsc.gov.in. Print it. This one page is your entire universe for the next two years — everything you read must trace back to a line on it.</p>

<h2>Step 2 — Master the Syllabus Like It's Your Optional</h2>
<p>Here's a hard truth premium academies teach and free content skips: <strong>the syllabus is not a checklist, it's a filter.</strong> Ninety percent of a beginner's wasted effort comes from reading things <em>not</em> demanded by the syllabus.</p>
<p>Do this in Week 1:</p>
<ol>
<li>Read the GS Prelims and GS Mains syllabus line by line.</li>
<li>Next to each line, note "what kind of question can UPSC ask here?"</li>
<li>Keep the syllabus taped to your wall. Every study session begins by locating today's topic <em>on the syllabus</em>.</li>
</ol>
<p>Aspirants who do this stop reading random material within a month. Those who don't keep buying books forever.</p>

<h2>Step 3 — Build Your Foundation with NCERTs (The Right Way)</h2>
<p>NCERTs are non-negotiable. They give you the vocabulary, concepts and neutral framing UPSC loves. <strong>But reading them casually is a waste.</strong> Read them with a purpose and link every chapter to the syllabus.</p>
<p><strong>Recommended NCERT order (Class 6–12):</strong></p>
<ul>
<li><strong>Polity:</strong> Class 9–12 (Indian Constitution at Work, Political Theory)</li>
<li><strong>History:</strong> Class 6–8 (overview), then Class 11–12 (Themes in Indian &amp; World History)</li>
<li><strong>Geography:</strong> Class 6–12 (Fundamentals of Physical &amp; Human Geography)</li>
<li><strong>Economics:</strong> Class 9–12 (Indian Economic Development)</li>
<li><strong>Science, Environment, Sociology:</strong> Class 6–10 for basics</li>
</ul>
<p><strong>How to read an NCERT (the mentor method):</strong></p>
<ol>
<li><strong>First pass:</strong> read the full chapter without a pen. Understand the story.</li>
<li><strong>Second pass:</strong> underline only syllabus-relevant facts and concepts.</li>
<li><strong>Third pass:</strong> make short, revisable notes (bullets, not paragraphs).</li>
<li>Move on. <strong>Do not</strong> perfect one book. You will return during revision.</li>
</ol>
<blockquote><p>Rule of thumb: NCERTs should take a disciplined beginner about <strong>6–8 weeks</strong>, not six months.</p></blockquote>

<h2>Step 4 — The Booklist: Limited Sources, Revised Repeatedly</h2>
<p>After NCERTs, move to <strong>standard reference books</strong> — but keep them minimal. More books do not mean more marks. <strong>Fewer books revised 4–5 times = marks.</strong></p>
<p>The trusted core (start these <em>after</em> NCERTs):</p>
<table><thead><tr><th>Subject</th><th>Standard Book</th></tr></thead><tbody>
<tr><td>Polity</td><td>Indian Polity — M. Laxmikanth</td></tr>
<tr><td>Modern History</td><td>A Brief History of Modern India — Spectrum</td></tr>
<tr><td>Geography</td><td>Certificate Physical &amp; Human Geography — G.C. Leong</td></tr>
<tr><td>Economy</td><td>Indian Economy — Ramesh Singh</td></tr>
<tr><td>Environment</td><td>Standard environment compilation + current affairs</td></tr>
<tr><td>Ethics (GS-IV)</td><td>Concept-based notes + case-study practice</td></tr>
</tbody></table>
<blockquote><p>Do not buy all of these on Day 1. Buy a subject's book only when you reach that subject. Analysis-paralysis at a bookstore has killed more attempts than any tough question.</p></blockquote>

<h2>Step 5 — Start the Newspaper Habit from Day 1</h2>
<p>Current affairs is not a "later" subject. It sits inside Prelims <em>and</em> every Mains GS paper. Begin now, even while doing NCERTs.</p>
<p><strong>How to read the newspaper (The Hindu / Indian Express) in ~45 minutes:</strong></p>
<ul>
<li><strong>Read for issues, not events.</strong> Skip celebrity news, sports (unless national), and local crime.</li>
<li>Focus on: <strong>Editorials &amp; Op-Eds, Governance &amp; Polity, Economy, Environment, International Relations, and Science &amp; Tech.</strong></li>
<li>Ask: <em>"Which part of the syllabus does this connect to?"</em> If it connects to none, skip it.</li>
<li>Maintain a single, topic-wise current affairs note (digital or notebook) that you can revise monthly.</li>
</ul>
<p>Beginners often over-invest here — spending 3 hours reading the paper cover to cover. <strong>45–60 minutes, focused, is enough.</strong> Consistency beats intensity.</p>

<h2>Step 6 — Choose Your Optional Subject Deliberately</h2>
<p>Your optional is <strong>~500 marks</strong> — often the difference between a rank and a repeat. Choose on logic, not emotion.</p>
<p>Weigh these four factors:</p>
<ol>
<li><strong>Genuine interest</strong> — you'll live with it for a year or more.</li>
<li><strong>Overlap with GS</strong> — subjects like Public Administration and PSIR overlap with Polity, Governance and Ethics, saving you time.</li>
<li><strong>Availability of quality guidance &amp; material</strong> — a great subject with no mentor is a trap.</li>
<li><strong>Scoring consistency</strong> — check past trends, not one topper's lucky year.</li>
</ol>
<blockquote><p>Public Administration is a popular first choice for beginners precisely because it's conceptually accessible and overlaps heavily with GS-II and GS-IV. If you're leaning that way, get proper mentorship early — an optional taught well pays back its cost many times over. <em>(This is where Naman Sir specialises.)</em></p></blockquote>

<h2>Step 7 — Answer Writing: The Skill Nobody Starts Early Enough</h2>
<p>This is the single biggest edge you can build. Mains is a <strong>writing exam</strong>, yet most aspirants start writing answers only months before Mains — far too late.</p>
<p>Start small, start now:</p>
<ul>
<li>After finishing a topic, <strong>write one 150-word answer</strong> on it in 7–8 minutes.</li>
<li>Structure: <strong>Introduction → Body (points/dimensions) → Conclusion (forward-looking).</strong></li>
<li>Focus on <strong>structure and clarity</strong>, not fancy vocabulary.</li>
<li>Get it evaluated. Un-reviewed answer writing just cements your mistakes.</li>
</ul>
<p>Aspirants who write from month one, and get feedback, routinely out-score "more knowledgeable" aspirants who only wrote in the last three months. <strong>Knowledge that can't be written down in the exam hall earns zero marks.</strong></p>

<h2>Step 8 — Your Beginner Timetable (A Realistic Template)</h2>
<p>You don't need 14 hours. You need <strong>6–8 focused hours</strong> and ruthless consistency.</p>
<p><strong>Sample beginner day (full-time aspirant):</strong></p>
<ul>
<li><strong>Morning (2.5 hrs):</strong> Static subject (NCERT/standard book) + short notes</li>
<li><strong>Midday (1 hr):</strong> Newspaper + current affairs note</li>
<li><strong>Afternoon (2 hrs):</strong> Second static subject OR optional</li>
<li><strong>Evening (1–1.5 hrs):</strong> Answer writing + revision of the day's learning</li>
<li><strong>Night (30 min):</strong> Quick recall of what you studied</li>
</ul>
<p><strong>Working professional / college student?</strong> Aim for <strong>3–4 truly focused hours</strong> on weekdays and longer sessions on weekends. A smaller plan you actually follow beats a heroic plan you abandon in two weeks.</p>
<blockquote><p>The best timetable is the one you can repeat tomorrow. Build for <strong>sustainability</strong>, not for a screenshot.</p></blockquote>

<h2>Step 9 — The Mistakes That Cost Beginners an Entire Year</h2>
<p>Learn these now, before they cost you months:</p>
<ol>
<li><strong>Endless resource collection</strong> — hoarding PDFs and buying every book. <em>Fix: limited sources, revised repeatedly.</em></li>
<li><strong>No revision plan</strong> — reading once and moving on. <em>Fix: revision is the exam; schedule it weekly and monthly.</em></li>
<li><strong>Delaying answer writing &amp; current affairs</strong> — treating them as "final year" work.</li>
<li><strong>Ignoring CSAT</strong> — then failing to qualify Paper II despite a great GS score.</li>
<li><strong>Copying a topper's timetable blindly</strong> — your life, strengths and hours are different.</li>
<li><strong>Studying in isolation with no feedback</strong> — you can't correct mistakes you can't see. This is exactly why structured mentorship and regular tests exist.</li>
<li><strong>Chasing motivation instead of building a system</strong> — motivation fades; systems carry you through the bad days.</li>
</ol>

<h2>How Many Hours Should a Beginner Study?</h2>
<p>There's no magic number, but here's the honest answer: <strong>quality times consistency beats raw hours.</strong> A focused 6–8 hours a day, sustained for 12–18 months with revision and answer writing built in, is more than enough to build a serious candidature. Ten distracted hours are not.</p>

<h2>Your First 30 Days: A Simple Starting Checklist</h2>
<ul>
<li>☐ Download &amp; print the official UPSC syllabus (upsc.gov.in)</li>
<li>☐ Start NCERTs — Polity and Modern History first</li>
<li>☐ Begin a 45-minute daily newspaper habit</li>
<li>☐ Open one topic-wise current-affairs note</li>
<li>☐ Write your first 150-word answer this week</li>
<li>☐ Shortlist (don't finalise) two optional subjects</li>
<li>☐ Build a realistic daily timetable you can actually repeat</li>
</ul>
<p>Do these seven things for 30 days and you'll be ahead of most aspirants who've been "preparing" for a year.</p>

<h2>Start the Right Way — Not the Hard Way</h2>
<p>If this guide gave you clarity, imagine what a structured first year with direct mentorship can do. Before you spend lakhs anywhere, <strong>experience the teaching first.</strong></p>
<ul>
<li><strong>Join Naman Sir's Beginner Masterclass</strong> — get the full booklist, syllabus walkthrough and a personalised starting roadmap, live.</li>
<li><strong>Book a free demo class</strong> or <strong>talk to a counsellor</strong> to plan your journey.</li>
</ul>
<p><strong>Naman Sharma IAS Academy</strong> — 9+ years guiding UPSC aspirants, with a special focus on beginners and Public Administration.<br>SCO 173–174, Sector 17C, Chandigarh · +91 84376 86541 · namanias.com</p>
<blockquote><p><em>"Start UPSC the right way — Chandigarh se bhi UPSC crack hota hai."</em></p></blockquote>
`;

const FAQ = [
  {
    q: "Can I start UPSC preparation from zero, without any coaching background?",
    a: "Yes. Every year, aspirants clear UPSC starting from absolute zero. What you need is the right sequence — syllabus, then NCERTs, then standard books, then current affairs and answer writing — plus consistency and feedback. Coaching or mentorship isn't mandatory, but it saves time and prevents the confusion that costs beginners their first year.",
  },
  {
    q: "How long does UPSC preparation take for a beginner?",
    a: "Most serious beginners need 12–18 months of consistent preparation to build a strong first attempt. Starting early (in college) gives you a real edge because you can build the newspaper and NCERT habits without pressure.",
  },
  {
    q: "Which subject should a beginner start with?",
    a: "Start with Polity (Laxmikanth after NCERTs) and Modern History (Spectrum) — they're scoring, factual, and build early confidence. Pair them with the daily newspaper.",
  },
  {
    q: "Do Prelims marks count in the final rank?",
    a: "No. Prelims is only a screening/qualifying stage. Your final rank is decided by Mains (seven counted papers) plus the Personality Test. That's why building Mains-level understanding early is so valuable.",
  },
  {
    q: "When should I start answer writing?",
    a: "From your first month, in small doses (one 150-word answer after each topic). Early, evaluated answer writing is the biggest scoring edge a beginner can build.",
  },
  {
    q: "How do I choose my optional subject?",
    a: "Balance four factors: genuine interest, overlap with GS, availability of quality guidance/material, and scoring consistency. Don't decide in week one — shortlist two, sample both, then commit.",
  },
  {
    q: "Is coaching necessary to clear UPSC?",
    a: "Not strictly. But structured guidance gives you a tested roadmap, weekly targets, answer evaluation and doubt-solving — which is why many beginners choose it to avoid wasting time. Whether you self-study or take mentorship, the fundamentals in this guide remain the same.",
  },
];

async function main() {
  const existing = await getResourceBySlug(SLUG);
  if (!existing) {
    console.error(`No resource found with slug "${SLUG}". Aborting.`);
    process.exit(1);
  }

  const seo: CaSeo = {
    ...existing.seo,
    title: "UPSC Preparation for Beginners: Day-1 Roadmap 2026",
    description:
      "Start UPSC the right way. A step-by-step beginner roadmap from Naman Sir — syllabus, booklist, timetable and the mistakes that cost aspirants a year. Read free.",
    keywords: [FOCUS, ...SECONDARY].join(", "),
    structured_data_enabled: true,
    faq_schema_enabled: true,
  };

  const patch = {
    slug: SLUG, // keep the clean URL — normalize would otherwise regenerate it from the new title
    title: TITLE,
    summary: SUMMARY,
    author: AUTHOR,
    focus_keyword: FOCUS,
    tags: Array.from(new Set([...(existing.tags || []), ...SECONDARY, "pending-review"])),
    body_html: BODY_HTML,
    faq: FAQ,
    seo,
    // reading_time omitted → auto-recalculated from the new body.
    reading_time: undefined,
    status: "draft" as const,
  };

  const normalized = normalizeResourceInput(patch);
  if (!normalized.ok || !normalized.value) {
    console.error("Normalization failed:", normalized.error);
    process.exit(1);
  }

  const v = normalized.value;
  console.log("=== UPDATE PLAN ===");
  console.log("slug        :", existing.slug, "(id:", existing.id + ")");
  console.log("title       :", v.title);
  console.log("author      :", v.author);
  console.log("status      :", v.status, "(unchanged — draft)");
  console.log("reading_time:", v.reading_time, "min (auto)");
  console.log("faq items   :", Array.isArray(v.faq) ? v.faq.length : 0);
  console.log("body chars  :", typeof v.body_html === "string" ? v.body_html.length : 0);
  console.log("seo.title   :", (v.seo as CaSeo).title);
  console.log("tags        :", (v.tags as string[]).join(", "));

  if (!COMMIT) {
    console.log("\nDRY-RUN. Re-run with --commit to write.");
    return;
  }

  const updated = await updateResource(existing.id, v as Record<string, unknown>);
  console.log(updated ? "\n✅ Updated draft in place." : "\n❌ Update returned null.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
