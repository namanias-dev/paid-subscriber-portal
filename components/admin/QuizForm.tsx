"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FormShell, Tabs, Section, Field, FormActions } from "./FormKit";
import { ImageUploadField, StringListEditor } from "./FormFields";
import RichTextEditor from "./RichTextEditor";
import { useToast } from "@/components/ui/Toast";
import { SUBJECTS } from "@/lib/config";
import type {
  Quiz, Question, QuizType, QuizExamType, QuizDifficulty, QuizLanguage, QuizStatus,
} from "@/lib/types";

const BACK = "/admin/quizzes";
const TYPES: QuizType[] = ["Daily", "CurrentAffairs", "Topic", "Subject", "Sectional", "FullMock", "Course", "PaidSubscriber", "FreePublic"];
const EXAM_TYPES: QuizExamType[] = ["PrelimsGS", "CSAT", "General"];
const DIFFS: QuizDifficulty[] = ["Easy", "Moderate", "Difficult", "UPSC-level"];
const LANGS: QuizLanguage[] = ["English", "Hindi", "Bilingual"];
const STATUSES: QuizStatus[] = ["draft", "published", "scheduled", "archived", "disabled"];

function stripHtml(html: string) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

export default function QuizForm({ quiz }: { quiz?: Quiz }) {
  const router = useRouter();
  const { toast } = useToast();
  const editing = !!quiz;

  // Basic
  const [title, setTitle] = useState(quiz?.title || "");
  const [slug, setSlug] = useState(quiz?.slug || "");
  const [description, setDescription] = useState(quiz?.description || "");
  const [instructions, setInstructions] = useState(quiz?.instructions_html || "");
  const [type, setType] = useState<QuizType>(quiz?.type || "Daily");
  const [examType, setExamType] = useState<QuizExamType>(quiz?.exam_type || "PrelimsGS");
  const [subject, setSubject] = useState(quiz?.subject || "");
  const [topic, setTopic] = useState(quiz?.topic || "");
  const [quizDate, setQuizDate] = useState(quiz?.quiz_date || "");
  const [difficulty, setDifficulty] = useState<QuizDifficulty>(quiz?.difficulty || "Moderate");
  const [language, setLanguage] = useState<QuizLanguage>(quiz?.language || "English");
  const [thumbnail, setThumbnail] = useState<string | null>(quiz?.thumbnail || null);
  const [status, setStatus] = useState<QuizStatus>(quiz?.status || "draft");

  // Scoring & timer
  const [marks, setMarks] = useState(quiz?.marks_per_question?.toString() || "2");
  const [negEnabled, setNegEnabled] = useState(quiz?.negative_marking_enabled ?? true);
  const [negFraction, setNegFraction] = useState(quiz?.negative_fraction?.toString() || "0.3333");
  const [negType, setNegType] = useState<"fraction" | "fixed">(quiz?.scoring_settings?.negative_marks_type || "fraction");
  const [noPenaltyBlank, setNoPenaltyBlank] = useState(quiz?.scoring_settings?.no_penalty_for_blank ?? true);
  const [passingMarks, setPassingMarks] = useState(quiz?.scoring_settings?.passing_marks?.toString() || "");
  const [timeLimitEnabled, setTimeLimitEnabled] = useState(quiz?.timing_settings?.time_limit_enabled ?? true);
  const [timeLimit, setTimeLimit] = useState(quiz?.time_limit_minutes?.toString() || "10");
  const [autoSubmit, setAutoSubmit] = useState(quiz?.timing_settings?.auto_submit_on_time_end ?? true);
  const [showTimer, setShowTimer] = useState(quiz?.timing_settings?.show_timer ?? true);
  const [resumeAllowed, setResumeAllowed] = useState(quiz?.timing_settings?.resume_allowed ?? true);

  // Access
  const [isPublic, setIsPublic] = useState(quiz?.is_public ?? true);
  const [requiresLogin, setRequiresLogin] = useState(quiz?.requires_login ?? false);
  const [requiresPayment, setRequiresPayment] = useState(quiz?.requires_payment ?? false);
  const [maxAttempts, setMaxAttempts] = useState(quiz?.max_attempts?.toString() || "");
  const [retryAllowed, setRetryAllowed] = useState(quiz?.attempt_settings?.retry_allowed ?? true);
  const [scoreCount, setScoreCount] = useState<"best" | "latest">(quiz?.attempt_settings?.score_count || "best");
  const [randomizeQ, setRandomizeQ] = useState(quiz?.attempt_settings?.randomize_question_order ?? false);
  const [randomizeO, setRandomizeO] = useState(quiz?.attempt_settings?.randomize_option_order ?? false);
  const [oneAtATime, setOneAtATime] = useState(quiz?.attempt_settings?.one_at_a_time ?? false);
  const [allowedCourseIds, setAllowedCourseIds] = useState<string[]>(quiz?.access_rules?.allowed_course_ids || []);
  const [expiresAt, setExpiresAt] = useState(quiz?.access_rules?.expires_at || "");

  // Result
  const r = quiz?.result_settings || {};
  const [showImmediate, setShowImmediate] = useState(r.show_result_immediately ?? true);
  const [showScore, setShowScore] = useState(r.show_score ?? true);
  const [showCorrect, setShowCorrect] = useState(r.show_correct_answers ?? true);
  const [showExpl, setShowExpl] = useState(r.show_explanations ?? true);
  const [showTopic, setShowTopic] = useState(r.show_topic_analysis ?? true);
  const [showRank, setShowRank] = useState(r.show_rank_percentile ?? true);
  const [showAnswerKey, setShowAnswerKey] = useState(r.show_answer_key ?? true);
  const [showPdf, setShowPdf] = useState(r.show_pdf_download ?? true);
  const [captureLead, setCaptureLead] = useState(r.capture_lead_before_result ?? false);

  // SEO
  const seo = quiz?.seo || {};
  const [seoTitle, setSeoTitle] = useState(seo.seo_title || "");
  const [seoDesc, setSeoDesc] = useState(seo.seo_description || "");
  const [seoKeywords, setSeoKeywords] = useState(seo.seo_keywords || "");
  const [ogImage, setOgImage] = useState<string | null>(seo.og_image || null);
  const [indexable, setIndexable] = useState(seo.indexable ?? true);
  const [includeSitemap, setIncludeSitemap] = useState(seo.include_in_sitemap ?? true);
  const [structuredData, setStructuredData] = useState(seo.structured_data_enabled ?? true);
  const [publicSummary, setPublicSummary] = useState(seo.public_summary || "");

  // Questions
  const [bank, setBank] = useState<Question[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bankQuery, setBankQuery] = useState("");
  const [bankSubject, setBankSubject] = useState("all");
  const [courses, setCourses] = useState<{ id: string; title: string }[]>([]);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/questions").then((r) => r.json()).then((d) => setBank(d.questions || []));
    fetch("/api/admin/courses").then((r) => r.json()).then((d) => setCourses((d.courses || []).map((c: { id: string; title: string }) => ({ id: c.id, title: c.title }))));
    if (editing) {
      fetch(`/api/admin/quizzes/${quiz!.id}/questions`)
        .then((r) => r.json())
        .then((d) => setSelectedIds((d.items || []).sort((a: { order_index: number }, b: { order_index: number }) => a.order_index - b.order_index).map((it: { question_id: string }) => it.question_id)));
    }
  }, [editing, quiz]);

  const filteredBank = useMemo(() => {
    const query = bankQuery.trim().toLowerCase();
    return bank.filter((q) => {
      if (bankSubject !== "all" && q.subject !== bankSubject) return false;
      if (query && !stripHtml(q.question_html).toLowerCase().includes(query)) return false;
      return true;
    });
  }, [bank, bankQuery, bankSubject]);

  function toggleQuestion(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function autoGenerate(quizId: string) {
    const res = await fetch(`/api/admin/quizzes/${quizId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: subject || undefined, topic: topic || undefined, difficulty: difficulty || undefined, count: Number(timeLimit) ? undefined : 10, replace: false, approvedOnly: false }),
    });
    const data = await res.json();
    if (data.ok) {
      setSelectedIds(data.questionIds || []);
      toast(`Selected ${data.picked} questions (${data.available} available)`, "success");
    } else {
      toast(data.error || "Generate failed", "error");
    }
  }

  function buildPayload() {
    return {
      title, slug, description, instructions_html: instructions,
      type, exam_type: examType, subject, topic, quiz_date: quizDate || null,
      difficulty, language, thumbnail, status,
      marks_per_question: Number(marks) || 2,
      negative_marking_enabled: negEnabled,
      negative_fraction: Number(negFraction) || 0,
      time_limit_minutes: timeLimitEnabled ? Number(timeLimit) || null : null,
      max_attempts: maxAttempts ? Number(maxAttempts) : null,
      is_public: isPublic, requires_login: requiresLogin, requires_payment: requiresPayment,
      scoring_settings: {
        negative_marks_type: negType, no_penalty_for_blank: noPenaltyBlank,
        passing_marks: passingMarks ? Number(passingMarks) : null,
        show_percentile: showRank, show_rank: showRank,
      },
      timing_settings: {
        time_limit_enabled: timeLimitEnabled, auto_submit_on_time_end: autoSubmit,
        server_time_validation: true, resume_allowed: resumeAllowed, show_timer: showTimer,
      },
      attempt_settings: {
        access_without_login: !requiresLogin, login_required: requiresLogin,
        retry_allowed: retryAllowed, score_count: scoreCount,
        randomize_question_order: randomizeQ, randomize_option_order: randomizeO,
        one_at_a_time: oneAtATime,
      },
      result_settings: {
        show_result_immediately: showImmediate, show_score: showScore,
        show_correct_answers: showCorrect, show_explanations: showExpl,
        show_topic_analysis: showTopic, show_rank_percentile: showRank,
        show_answer_key: showAnswerKey, show_pdf_download: showPdf,
        capture_lead_before_result: captureLead,
      },
      access_rules: {
        allowed_course_ids: allowedCourseIds,
        expires_at: expiresAt || null,
      },
      seo: {
        seo_title: seoTitle, seo_description: seoDesc, seo_keywords: seoKeywords,
        og_image: ogImage || undefined, indexable, include_in_sitemap: includeSitemap,
        structured_data_enabled: structuredData, public_summary: publicSummary,
      },
    };
  }

  async function saveQuestions(quizId: string, force = false): Promise<boolean> {
    const items = selectedIds.map((id, i) => ({ question_id: id, order_index: i }));
    const res = await fetch(`/api/admin/quizzes/${quizId}/questions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, force }),
    });
    const data = await res.json();
    if (data.ok) return true;
    if (data.needsConfirm && !force) {
      if (confirm(data.error)) return saveQuestions(quizId, true);
      return false;
    }
    toast(data.error || "Failed to save questions", "error");
    return false;
  }

  async function save() {
    if (!title.trim()) return toast("Title is required", "error");
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/admin/quizzes/${quiz!.id}` : "/api/admin/quizzes", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (!data.ok) {
        toast(data.error || "Failed to save quiz", "error");
        return;
      }
      const quizId = data.quiz.id;
      await saveQuestions(quizId);
      toast(editing ? "Quiz updated" : "Quiz created", "success");
      router.push(BACK);
    } catch {
      toast("Failed to save quiz", "error");
    } finally {
      setSaving(false);
    }
  }

  const basicTab = (
    <>
      <Section title="Basic info">
        <Field label="Title" full>
          <input className="input" value={title} onChange={(e) => { setTitle(e.target.value); if (!editing && !slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")); }} placeholder="UPSC Prelims-style Polity Quiz" />
        </Field>
        <Field label="Slug" hint="URL: /quizzes/your-slug">
          <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="polity-mcq-practice" />
        </Field>
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as QuizStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Short description" full>
          <textarea className="input min-h-[70px]" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Type">
          <select className="input" value={type} onChange={(e) => setType(e.target.value as QuizType)}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Exam type">
          <select className="input" value={examType} onChange={(e) => setExamType(e.target.value as QuizExamType)}>
            {EXAM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Subject">
          <input className="input" list="quiz-subjects" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <datalist id="quiz-subjects">{SUBJECTS.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="Topic">
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} />
        </Field>
        <Field label="Quiz date">
          <input type="date" className="input" value={quizDate || ""} onChange={(e) => setQuizDate(e.target.value)} />
        </Field>
        <Field label="Difficulty">
          <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as QuizDifficulty)}>
            {DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Language">
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value as QuizLanguage)}>
            {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <ImageUploadField label="Thumbnail" value={thumbnail} onChange={setThumbnail} folder="quizzes" />
      </Section>
      <Section title="Instructions" desc="Shown on the intro page before the test starts.">
        <div className="sm:col-span-2"><RichTextEditor value={instructions} onChange={setInstructions} placeholder="Read the instructions carefully…" /></div>
      </Section>
    </>
  );

  const questionsTab = (
    <Section title={`Questions (${selectedIds.length} selected)`} desc="Pick from the bank or auto-generate by the quiz's subject/topic/difficulty.">
      <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs flex-1" placeholder="Search bank" value={bankQuery} onChange={(e) => setBankQuery(e.target.value)} />
        <select className="input max-w-[160px]" value={bankSubject} onChange={(e) => setBankSubject(e.target.value)}>
          <option value="all">All subjects</option>
          {SUBJECTS.map((s) => <option key={s}>{s}</option>)}
        </select>
        {editing && <button type="button" className="btn btn-secondary text-sm" onClick={() => autoGenerate(quiz!.id)}>⚡ Auto-generate</button>}
      </div>
      <div className="sm:col-span-2 max-h-[420px] overflow-y-auto rounded-xl border border-line">
        {filteredBank.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted">No questions in the bank yet.</p>
        ) : (
          filteredBank.map((q) => {
            const idx = selectedIds.indexOf(q.id);
            return (
              <label key={q.id} className="flex cursor-pointer items-start gap-3 border-b border-line px-3 py-2.5 text-sm last:border-0 hover:bg-surface2">
                <input type="checkbox" checked={idx !== -1} onChange={() => toggleQuestion(q.id)} className="mt-1" />
                {idx !== -1 && <span className="pill pill-blue">{idx + 1}</span>}
                <span className="flex-1">
                  <span className="line-clamp-2">{stripHtml(q.question_html)}</span>
                  <span className="mt-0.5 block text-xs text-muted">{q.subject || "—"} · {q.difficulty} · Ans {q.correct_option}</span>
                </span>
              </label>
            );
          })
        )}
      </div>
      {!editing && <p className="sm:col-span-2 text-xs text-muted">Tip: Save the quiz first, then re-open to use auto-generate.</p>}
    </Section>
  );

  const scoringTab = (
    <>
      <Section title="Scoring">
        <Field label="Marks per question"><input type="number" step="0.5" className="input" value={marks} onChange={(e) => setMarks(e.target.value)} /></Field>
        <Field label="Passing marks (optional)"><input type="number" className="input" value={passingMarks} onChange={(e) => setPassingMarks(e.target.value)} /></Field>
        <Field label="Negative marking"><Toggle label="Enable negative marking" checked={negEnabled} onChange={setNegEnabled} /></Field>
        <Field label="Negative type">
          <select className="input" value={negType} onChange={(e) => setNegType(e.target.value as "fraction" | "fixed")}>
            <option value="fraction">Fraction of marks (e.g. 1/3)</option>
            <option value="fixed">Fixed marks</option>
          </select>
        </Field>
        <Field label={negType === "fraction" ? "Negative fraction (e.g. 0.3333)" : "Negative marks (fixed)"}>
          <input type="number" step="0.0001" className="input" value={negFraction} onChange={(e) => setNegFraction(e.target.value)} />
        </Field>
        <Field label="Blanks"><Toggle label="No penalty for blank answers" checked={noPenaltyBlank} onChange={setNoPenaltyBlank} /></Field>
      </Section>
      <Section title="Timer">
        <Field label="Time limit"><Toggle label="Enable time limit" checked={timeLimitEnabled} onChange={setTimeLimitEnabled} /></Field>
        <Field label="Minutes"><input type="number" className="input" value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} disabled={!timeLimitEnabled} /></Field>
        <Field label="Auto-submit"><Toggle label="Auto-submit when time ends" checked={autoSubmit} onChange={setAutoSubmit} /></Field>
        <Field label="Show timer"><Toggle label="Show countdown timer" checked={showTimer} onChange={setShowTimer} /></Field>
        <Field label="Resume"><Toggle label="Allow resume if tab closed" checked={resumeAllowed} onChange={setResumeAllowed} /></Field>
      </Section>
    </>
  );

  const accessTab = (
    <>
      <Section title="Access">
        <Field label="Visibility"><Toggle label="Public (crawlable, no login)" checked={isPublic} onChange={setIsPublic} /></Field>
        <Field label="Login"><Toggle label="Requires login" checked={requiresLogin} onChange={setRequiresLogin} /></Field>
        <Field label="Paid test" hint="When on, only learners enrolled in a course that grants this test (below) can take it. Free quizzes stay open."><Toggle label="Paid — unlock via course enrolment" checked={requiresPayment} onChange={setRequiresPayment} /></Field>
        <Field label="Max attempts (blank = unlimited)"><input type="number" className="input" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} /></Field>
        <Field label="Retry"><Toggle label="Retry allowed" checked={retryAllowed} onChange={setRetryAllowed} /></Field>
        <Field label="Counted score">
          <select className="input" value={scoreCount} onChange={(e) => setScoreCount(e.target.value as "best" | "latest")}>
            <option value="best">Best score</option>
            <option value="latest">Latest score</option>
          </select>
        </Field>
        <Field label="Randomize questions"><Toggle label="Shuffle question order" checked={randomizeQ} onChange={setRandomizeQ} /></Field>
        <Field label="Randomize options"><Toggle label="Shuffle option order" checked={randomizeO} onChange={setRandomizeO} /></Field>
        <Field label="One at a time"><Toggle label="Show one question at a time" checked={oneAtATime} onChange={setOneAtATime} /></Field>
        <Field label="Expires at (optional)"><input type="datetime-local" className="input" value={expiresAt || ""} onChange={(e) => setExpiresAt(e.target.value)} /></Field>
      </Section>
      <Section title="Unlocked by courses" desc="Select which courses grant access to this test. For a Paid test, enrolling in any of these unlocks it (no lead form). You can also set this from each course's Access & Entitlements tab — both directions work.">
        <div className="sm:col-span-2 space-y-1">
          {courses.length === 0 ? <p className="text-sm text-muted">No courses available.</p> : courses.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allowedCourseIds.includes(c.id)} onChange={() => setAllowedCourseIds((prev) => prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id])} />
              {c.title}
            </label>
          ))}
        </div>
      </Section>
    </>
  );

  const resultTab = (
    <Section title="Result visibility">
      <Field label="Timing"><Toggle label="Show result immediately" checked={showImmediate} onChange={setShowImmediate} /></Field>
      <Field label="Score"><Toggle label="Show score" checked={showScore} onChange={setShowScore} /></Field>
      <Field label="Answers"><Toggle label="Show correct answers" checked={showCorrect} onChange={setShowCorrect} /></Field>
      <Field label="Explanations"><Toggle label="Show explanations" checked={showExpl} onChange={setShowExpl} /></Field>
      <Field label="Topic analysis"><Toggle label="Show topic-wise analysis" checked={showTopic} onChange={setShowTopic} /></Field>
      <Field label="Rank"><Toggle label="Show rank & percentile" checked={showRank} onChange={setShowRank} /></Field>
      <Field label="Answer key"><Toggle label="Show answer key" checked={showAnswerKey} onChange={setShowAnswerKey} /></Field>
      <Field label="PDF"><Toggle label="Allow PDF / print download" checked={showPdf} onChange={setShowPdf} /></Field>
      <Field label="Lead capture"><Toggle label="Capture name/mobile before result (public)" checked={captureLead} onChange={setCaptureLead} /></Field>
    </Section>
  );

  const seoTab = (
    <>
      <Section title="SEO">
        <Field label="SEO title" full><input className="input" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder={title} /></Field>
        <Field label="Meta description" full><textarea className="input min-h-[60px]" value={seoDesc} onChange={(e) => setSeoDesc(e.target.value)} /></Field>
        <Field label="Keywords" full><input className="input" value={seoKeywords} onChange={(e) => setSeoKeywords(e.target.value)} placeholder="upsc, prelims, polity" /></Field>
        <ImageUploadField label="OG / social image" value={ogImage} onChange={setOgImage} folder="quizzes" />
        <Field label="Indexing"><Toggle label="Allow search engines to index" checked={indexable} onChange={setIndexable} /></Field>
        <Field label="Sitemap"><Toggle label="Include in sitemap" checked={includeSitemap} onChange={setIncludeSitemap} /></Field>
        <Field label="Structured data"><Toggle label="Emit JSON-LD structured data" checked={structuredData} onChange={setStructuredData} /></Field>
      </Section>
      <Section title="Public summary" desc="Crawlable intro shown on the public quiz page.">
        <div className="sm:col-span-2"><RichTextEditor value={publicSummary} onChange={setPublicSummary} placeholder="Why this practice test helps UPSC aspirants…" /></div>
      </Section>
    </>
  );

  return (
    <FormShell title={editing ? "Edit Quiz" : "New Quiz"} subtitle="UPSC Prelims-style practice test." backHref={BACK}>
      <Tabs
        items={[
          { id: "basic", label: "Basic Info", content: basicTab },
          { id: "questions", label: "Questions", content: questionsTab },
          { id: "scoring", label: "Scoring & Timer", content: scoringTab },
          { id: "access", label: "Access Rules", content: accessTab },
          { id: "result", label: "Result Settings", content: resultTab },
          { id: "seo", label: "SEO", content: seoTab },
        ]}
      />
      <FormActions saving={saving} onSave={save} cancelHref={BACK} saveLabel={editing ? "Update Quiz" : "Create Quiz"} />
    </FormShell>
  );
}
