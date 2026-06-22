"use client";

import { useEffect, useState } from "react";
import { FormShell, Section, Field, FormActions } from "./FormKit";
import { useToast } from "@/components/ui/Toast";
import { DEFAULT_SITE_SETTINGS, DEFAULT_ABOUT } from "@/lib/homeDefaults";
import type { SiteSettings, AboutContent, AboutValue } from "@/lib/types";

const BACK = "/admin";

export default function AboutForm() {
  const { toast } = useToast();
  const [s, setS] = useState<SiteSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/home");
        const data = await res.json();
        setS(data.ok ? data.settings : DEFAULT_SITE_SETTINGS);
      } catch {
        setS(DEFAULT_SITE_SETTINGS);
      }
    })();
  }, []);

  if (!s) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <div className="skeleton h-10 w-56" />
        <div className="skeleton mt-4 h-64 w-full" />
      </div>
    );
  }

  const about: AboutContent = { ...DEFAULT_ABOUT, ...(s.about || {}) };
  const set = (patch: Partial<AboutContent>) => setS({ ...s, about: { ...about, ...patch } });
  const values = about.values?.length ? about.values : DEFAULT_ABOUT.values || [];
  const setValue = (i: number, patch: Partial<AboutValue>) =>
    set({ values: values.map((v, idx) => (idx === i ? { ...v, ...patch } : v)) });

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/home", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ about: s!.about }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) toast("About page updated", "success");
      else toast(data.error || "Failed to save", "error");
    } catch {
      toast("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormShell title="About Page" subtitle="Edit the text shown on the public About page. Layout and design stay the same — only the copy changes." backHref={BACK}>
      <Section title="Hero">
        <Field label="Eyebrow / pill">
          <input className="input" value={about.hero_eyebrow || ""} onChange={(e) => set({ hero_eyebrow: e.target.value })} placeholder={DEFAULT_ABOUT.hero_eyebrow} />
        </Field>
        <Field label="Title" full>
          <textarea className="input" rows={2} value={about.hero_title || ""} onChange={(e) => set({ hero_title: e.target.value })} placeholder={DEFAULT_ABOUT.hero_title} />
        </Field>
        <Field label="Intro paragraph" full>
          <textarea className="input" rows={3} value={about.hero_intro || ""} onChange={(e) => set({ hero_intro: e.target.value })} placeholder={DEFAULT_ABOUT.hero_intro} />
        </Field>
      </Section>

      <Section title="Meet Naman Sir" desc="Use a blank line between paragraphs to split them.">
        <Field label="Heading" full>
          <input className="input" value={about.mentor_heading || ""} onChange={(e) => set({ mentor_heading: e.target.value })} placeholder={DEFAULT_ABOUT.mentor_heading} />
        </Field>
        <Field label="Body" full hint="Separate paragraphs with a blank line.">
          <textarea className="input" rows={6} value={about.mentor_body || ""} onChange={(e) => set({ mentor_body: e.target.value })} placeholder={DEFAULT_ABOUT.mentor_body} />
        </Field>
      </Section>

      <Section title="Our values">
        <Field label="Section heading" full>
          <input className="input" value={about.values_heading || ""} onChange={(e) => set({ values_heading: e.target.value })} placeholder={DEFAULT_ABOUT.values_heading} />
        </Field>
        <div className="sm:col-span-2 space-y-3">
          {values.map((v, i) => (
            <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[70px_1fr]">
              <div>
                <label className="label">Icon</label>
                <input className="input text-center" value={v.icon || ""} onChange={(e) => setValue(i, { icon: e.target.value })} placeholder="🤝" />
              </div>
              <div className="space-y-2">
                <input className="input" value={v.title || ""} onChange={(e) => setValue(i, { title: e.target.value })} placeholder="Value title" />
                <textarea className="input" rows={2} value={v.desc || ""} onChange={(e) => setValue(i, { desc: e.target.value })} placeholder="Short description" />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <FormActions saving={saving} onSave={save} cancelHref={BACK} saveLabel="Save About Page" />
    </FormShell>
  );
}
