"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormShell, Section, Field, FormActions } from "./FormKit";
import { StringListEditor } from "./FormFields";
import RichTextEditor from "./RichTextEditor";
import { useToast } from "@/components/ui/Toast";
import { SUBJECTS } from "@/lib/config";
import type { Question, QuizOptionKey, QuizDifficulty } from "@/lib/types";

const BACK = "/admin/questions";
const DIFFS: QuizDifficulty[] = ["Easy", "Moderate", "Difficult", "UPSC-level"];
const OPTION_KEYS = ["A", "B", "C", "D"] as const;
type OptKey = (typeof OPTION_KEYS)[number];

export default function QuestionForm({ question }: { question?: Question }) {
  const router = useRouter();
  const { toast } = useToast();
  const editing = !!question;

  const [questionHtml, setQuestionHtml] = useState(question?.question_html || "");
  const [options, setOptions] = useState<Record<OptKey, string>>({
    A: question?.options?.A || "",
    B: question?.options?.B || "",
    C: question?.options?.C || "",
    D: question?.options?.D || "",
  });
  const [correct, setCorrect] = useState<QuizOptionKey>(question?.correct_option || "A");
  const [explanation, setExplanation] = useState(question?.explanation_html || "");
  const [subject, setSubject] = useState(question?.subject || "");
  const [topic, setTopic] = useState(question?.topic || "");
  const [difficulty, setDifficulty] = useState<QuizDifficulty>(question?.difficulty || "Moderate");
  const [tags, setTags] = useState<string[]>(question?.tags || []);
  const [isPyq, setIsPyq] = useState(question?.is_pyq || false);
  const [pyqYear, setPyqYear] = useState(question?.pyq_year?.toString() || "");
  const [status, setStatus] = useState<Question["status"]>(question?.status || "draft");
  const [approved, setApproved] = useState(question?.quality_status === "approved");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!questionHtml.trim()) return toast("Question text is required", "error");
    if (!options.A || !options.B || !options.C || !options.D) return toast("All four options are required", "error");
    setSaving(true);
    const payload = {
      question_html: questionHtml,
      options,
      correct_option: correct,
      explanation_html: explanation,
      subject: subject || null,
      topic: topic || null,
      difficulty,
      tags,
      is_pyq: isPyq,
      pyq_year: pyqYear ? Number(pyqYear) : null,
      status,
      quality_status: approved ? "approved" : "unreviewed",
    };
    try {
      const res = await fetch(editing ? `/api/admin/questions/${question!.id}` : "/api/admin/questions", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) {
        toast(editing ? "Question updated" : "Question created", "success");
        router.push(BACK);
      } else {
        toast(data.error || "Failed to save", "error");
      }
    } catch {
      toast("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormShell title={editing ? "Edit Question" : "New Question"} subtitle="UPSC Prelims-style single-correct MCQ." backHref={BACK}>
      <Section title="Question" desc="The question stem. Rich text & images supported.">
        <div className="sm:col-span-2">
          <label className="label">Question text</label>
          <RichTextEditor value={questionHtml} onChange={setQuestionHtml} placeholder="Enter the question…" />
        </div>
      </Section>

      <Section title="Options & answer" desc="Provide options A–D and mark the correct one.">
        {OPTION_KEYS.map((k) => (
          <Field key={k} label={`Option ${k}`} full>
            <div className="flex items-center gap-3">
              <input
                type="radio"
                name="correct"
                checked={correct === k}
                onChange={() => setCorrect(k)}
                title="Mark as correct"
              />
              <input
                className="input flex-1"
                value={options[k]}
                onChange={(e) => setOptions({ ...options, [k]: e.target.value })}
                placeholder={`Option ${k}`}
              />
            </div>
          </Field>
        ))}
        <Field label="Correct answer">
          <select className="input" value={correct} onChange={(e) => setCorrect(e.target.value as QuizOptionKey)}>
            {OPTION_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
      </Section>

      <Section title="Explanation" desc="Shown on the result page after submission.">
        <div className="sm:col-span-2">
          <RichTextEditor value={explanation} onChange={setExplanation} placeholder="Explain the correct answer…" />
        </div>
      </Section>

      <Section title="Classification">
        <Field label="Subject">
          <input className="input" list="subjects" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Polity" />
          <datalist id="subjects">{SUBJECTS.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="Topic">
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Fundamental Rights" />
        </Field>
        <Field label="Difficulty">
          <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as QuizDifficulty)}>
            {DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Tags">
          <StringListEditor value={tags} onChange={setTags} placeholder="e.g. constitution" addLabel="+ Add tag" />
        </Field>
        <Field label="Previous-year question?">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isPyq} onChange={(e) => setIsPyq(e.target.checked)} /> Mark as PYQ</label>
        </Field>
        {isPyq && (
          <Field label="PYQ year">
            <input type="number" className="input" value={pyqYear} onChange={(e) => setPyqYear(e.target.value)} placeholder="2019" />
          </Field>
        )}
      </Section>

      <Section title="Publishing">
        <Field label="Status">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as Question["status"])}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
        <Field label="Quality">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> Approved / reviewed</label>
        </Field>
      </Section>

      <FormActions saving={saving} onSave={save} cancelHref={BACK} saveLabel={editing ? "Update Question" : "Create Question"} />
    </FormShell>
  );
}
