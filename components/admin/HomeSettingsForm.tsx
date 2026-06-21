"use client";

import { useEffect, useState } from "react";
import { FormShell, Section, Field, FormActions, Tabs } from "./FormKit";
import { ImageUploadField, StringListEditor } from "./FormFields";
import { useToast } from "@/components/ui/Toast";
import { DEFAULT_SITE_SETTINGS } from "@/lib/homeDefaults";
import type { SiteSettings, HeroButton, HeroStat, HeroButtonStyle } from "@/lib/types";

const BACK = "/admin";
const BTN_STYLES: HeroButtonStyle[] = ["primary", "saffron", "gold", "secondary"];

export default function HomeSettingsForm() {
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

  const setLogo = (patch: Partial<Pick<SiteSettings, "logo_url" | "logo_alt">>) => setS({ ...s, ...patch });
  const setHero = (patch: Partial<SiteSettings["hero"]>) => setS({ ...s, hero: { ...s.hero, ...patch } });
  const setPopup = (patch: Partial<SiteSettings["popup"]>) => setS({ ...s, popup: { ...s.popup, ...patch } });
  const setContent = (patch: Partial<SiteSettings["content"]>) => setS({ ...s, content: { ...s.content, ...patch } });

  const buttons = s.hero.buttons || [];
  const setButton = (i: number, patch: Partial<HeroButton>) =>
    setHero({ buttons: buttons.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) });

  const stats = s.hero.stats || [];
  const setStat = (i: number, patch: Partial<HeroStat>) =>
    setHero({ stats: stats.map((b, idx) => (idx === i ? { ...b, ...patch } : b)) });

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/home", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) toast("Home page updated", "success");
      else toast(data.error || "Failed to save", "error");
    } catch {
      toast("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  const c = s.content;

  return (
    <FormShell title="Home Page" subtitle="Control the public home page content, hero, logo and lead popup." backHref={BACK}>
      <Tabs
        items={[
          {
            id: "branding",
            label: "Branding / Logo",
            content: (
              <Section title="Site logo" desc="Shown in the header. PNG/SVG with transparency recommended. Falls back to the default wordmark.">
                <ImageUploadField label="Logo image" folder="branding" value={s.logo_url} onChange={(url) => setLogo({ logo_url: url })} hint="Transparent PNG or SVG. Displayed ~40px tall; width scales automatically." />
                <Field label="Logo alt text" hint="For SEO & accessibility.">
                  <input className="input" value={s.logo_alt || ""} onChange={(e) => setLogo({ logo_alt: e.target.value })} placeholder="Naman Sharma IAS Academy" />
                </Field>
              </Section>
            ),
          },
          {
            id: "hero",
            label: "Hero",
            content: (
              <>
                <Section title="Hero text" desc="The headline area at the top of the home page.">
                  <Field label="Badge / eyebrow" full>
                    <input className="input" value={s.hero.badge || ""} onChange={(e) => setHero({ badge: e.target.value })} placeholder={DEFAULT_SITE_SETTINGS.hero.badge} />
                  </Field>
                  <Field label="Headline" full hint='Words "Naman" / "Sir" are auto-highlighted.'>
                    <textarea className="input" rows={2} value={s.hero.headline || ""} onChange={(e) => setHero({ headline: e.target.value })} placeholder={DEFAULT_SITE_SETTINGS.hero.headline} />
                  </Field>
                  <Field label="Subheading" full>
                    <textarea className="input" rows={3} value={s.hero.subheading || ""} onChange={(e) => setHero({ subheading: e.target.value })} placeholder={DEFAULT_SITE_SETTINGS.hero.subheading} />
                  </Field>
                </Section>

                <Section title="Mentor portrait" desc="Transparent PNG of Naman Sir shown in the hero. When empty, the animated visual is shown instead.">
                  <ImageUploadField label="Portrait (transparent PNG)" folder="hero" value={s.hero.portrait_url} onChange={(url) => setHero({ portrait_url: url })} hint="Use a background-removed PNG for best results." />
                  <Field label="Portrait alt text">
                    <input className="input" value={s.hero.portrait_alt || ""} onChange={(e) => setHero({ portrait_alt: e.target.value })} placeholder="Naman Sir — UPSC Mentor" />
                  </Field>
                </Section>

                <Section title="Hero buttons" desc="Toggle, label and link each call-to-action independently.">
                  <div className="sm:col-span-2 space-y-3">
                    {buttons.map((b, i) => (
                      <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[auto_1fr_1fr_130px] sm:items-center">
                        <label className="flex items-center gap-2 text-sm font-medium">
                          <input type="checkbox" checked={!!b.enabled} onChange={(e) => setButton(i, { enabled: e.target.checked })} /> On
                        </label>
                        <input className="input" placeholder="Button label" value={b.label} onChange={(e) => setButton(i, { label: e.target.value })} />
                        <input className="input" placeholder="/demo or https://…" value={b.href} onChange={(e) => setButton(i, { href: e.target.value })} />
                        <select className="input" value={b.style || "primary"} onChange={(e) => setButton(i, { style: e.target.value as HeroButtonStyle })}>
                          {BTN_STYLES.map((st) => <option key={st} value={st}>{st}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Hero stats" desc="The four counters under the buttons.">
                  <div className="sm:col-span-2 space-y-3">
                    {stats.map((st, i) => (
                      <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_1.4fr] sm:items-center">
                        <input type="number" className="input" placeholder="Value" value={st.value} onChange={(e) => setStat(i, { value: Number(e.target.value) })} />
                        <input className="input" placeholder="Suffix (K+, +)" value={st.suffix} onChange={(e) => setStat(i, { suffix: e.target.value })} />
                        <input className="input" placeholder="Label" value={st.label} onChange={(e) => setStat(i, { label: e.target.value })} />
                      </div>
                    ))}
                  </div>
                </Section>
              </>
            ),
          },
          {
            id: "popup",
            label: "Lead Popup",
            content: (
              <Section title="Timed lead-capture popup" desc="Auto-opens on the home page after a delay. Submissions appear in Lead CRM (source: home_popup).">
                <label className="flex items-center gap-3 sm:col-span-2">
                  <input type="checkbox" checked={!!s.popup.enabled} onChange={(e) => setPopup({ enabled: e.target.checked })} />
                  <span className="text-sm"><b>{s.popup.enabled ? "Enabled" : "Disabled"}</b> — show the popup to home page visitors.</span>
                </label>
                <Field label="Delay (seconds)" hint="0–120. Default 5.">
                  <input type="number" min={0} max={120} className="input" value={s.popup.delay_seconds ?? 5} onChange={(e) => setPopup({ delay_seconds: Number(e.target.value) })} />
                </Field>
                <Field label="Button text">
                  <input className="input" value={s.popup.button_text || ""} onChange={(e) => setPopup({ button_text: e.target.value })} placeholder={DEFAULT_SITE_SETTINGS.popup.button_text} />
                </Field>
                <Field label="Heading" full>
                  <input className="input" value={s.popup.heading || ""} onChange={(e) => setPopup({ heading: e.target.value })} placeholder={DEFAULT_SITE_SETTINGS.popup.heading} />
                </Field>
                <Field label="Subtext" full>
                  <input className="input" value={s.popup.subtext || ""} onChange={(e) => setPopup({ subtext: e.target.value })} placeholder={DEFAULT_SITE_SETTINGS.popup.subtext} />
                </Field>
                <Field label="Success message" full>
                  <input className="input" value={s.popup.success_message || ""} onChange={(e) => setPopup({ success_message: e.target.value })} placeholder={DEFAULT_SITE_SETTINGS.popup.success_message} />
                </Field>
                <Field label="Course-interest options" full hint="Shown as a dropdown in the popup form.">
                  <StringListEditor value={s.popup.interest_options} onChange={(v) => setPopup({ interest_options: v })} placeholder="e.g. UPSC Foundation" addLabel="+ Add option" />
                </Field>
              </Section>
            ),
          },
          {
            id: "content",
            label: "Sections",
            content: (
              <>
                <Section title="Trust bar" desc="The strip of badges under the hero.">
                  <Field label="Items" full>
                    <StringListEditor value={c.trust_bar} onChange={(v) => setContent({ trust_bar: v })} placeholder="e.g. ⭐ 388K+ Instagram" addLabel="+ Add item" />
                  </Field>
                </Section>
                <Section title="Section headings">
                  <Field label="'Why' eyebrow"><input className="input" value={c.why_sub || ""} onChange={(e) => setContent({ why_sub: e.target.value })} /></Field>
                  <Field label="'Why' heading"><input className="input" value={c.why_heading || ""} onChange={(e) => setContent({ why_heading: e.target.value })} /></Field>
                  <Field label="Modes heading"><input className="input" value={c.modes_heading || ""} onChange={(e) => setContent({ modes_heading: e.target.value })} /></Field>
                  <Field label="Modes subtext"><input className="input" value={c.modes_sub || ""} onChange={(e) => setContent({ modes_sub: e.target.value })} /></Field>
                  <Field label="Courses heading"><input className="input" value={c.courses_heading || ""} onChange={(e) => setContent({ courses_heading: e.target.value })} /></Field>
                  <Field label="Courses subtext"><input className="input" value={c.courses_sub || ""} onChange={(e) => setContent({ courses_sub: e.target.value })} /></Field>
                  <Field label="Results heading"><input className="input" value={c.results_heading || ""} onChange={(e) => setContent({ results_heading: e.target.value })} /></Field>
                  <Field label="Results subtext"><input className="input" value={c.results_sub || ""} onChange={(e) => setContent({ results_sub: e.target.value })} /></Field>
                  <Field label="Free resources heading" full><input className="input" value={c.free_heading || ""} onChange={(e) => setContent({ free_heading: e.target.value })} /></Field>
                  <Field label="Testimonials heading"><input className="input" value={c.testimonials_heading || ""} onChange={(e) => setContent({ testimonials_heading: e.target.value })} /></Field>
                  <Field label="FAQ heading"><input className="input" value={c.faq_heading || ""} onChange={(e) => setContent({ faq_heading: e.target.value })} /></Field>
                  <Field label="Locations heading"><input className="input" value={c.locations_heading || ""} onChange={(e) => setContent({ locations_heading: e.target.value })} /></Field>
                  <Field label="Locations subtext"><input className="input" value={c.locations_sub || ""} onChange={(e) => setContent({ locations_sub: e.target.value })} /></Field>
                </Section>
                <Section title="₹50 promo band">
                  <Field label="Heading"><input className="input" value={c.band_heading || ""} onChange={(e) => setContent({ band_heading: e.target.value })} /></Field>
                  <Field label="Subtext"><input className="input" value={c.band_subtext || ""} onChange={(e) => setContent({ band_subtext: e.target.value })} /></Field>
                  <Field label="Primary button label"><input className="input" value={c.band_primary_label || ""} onChange={(e) => setContent({ band_primary_label: e.target.value })} /></Field>
                  <Field label="Primary button link"><input className="input" value={c.band_primary_href || ""} onChange={(e) => setContent({ band_primary_href: e.target.value })} /></Field>
                  <Field label="Secondary button label"><input className="input" value={c.band_secondary_label || ""} onChange={(e) => setContent({ band_secondary_label: e.target.value })} /></Field>
                  <Field label="Secondary button link"><input className="input" value={c.band_secondary_href || ""} onChange={(e) => setContent({ band_secondary_href: e.target.value })} /></Field>
                </Section>
                <Section title="Lead counselling section">
                  <Field label="Heading"><input className="input" value={c.lead_heading || ""} onChange={(e) => setContent({ lead_heading: e.target.value })} /></Field>
                  <Field label="Subtext"><input className="input" value={c.lead_sub || ""} onChange={(e) => setContent({ lead_sub: e.target.value })} /></Field>
                </Section>
              </>
            ),
          },
        ]}
      />

      <FormActions saving={saving} onSave={save} cancelHref={BACK} saveLabel="Save Home Page" />
    </FormShell>
  );
}
