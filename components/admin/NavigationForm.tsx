"use client";

import { useEffect, useState } from "react";
import { FormShell, Section, FormActions } from "./FormKit";
import { useToast } from "@/components/ui/Toast";
import { DEFAULT_SITE_SETTINGS } from "@/lib/homeDefaults";
import { DEFAULT_NAV_TABS } from "@/lib/navConfig";
import type { SiteSettings, NavConfig, NavItemSetting } from "@/lib/types";

const BACK = "/admin";

export default function NavigationForm() {
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

  const nav: NavConfig = s.nav || { overrides: {} };
  const overrides = nav.overrides || {};
  const get = (href: string): NavItemSetting => overrides[href] || {};
  const setOverride = (href: string, patch: Partial<NavItemSetting>) =>
    setS({ ...s, nav: { overrides: { ...overrides, [href]: { ...get(href), ...patch } } } });

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/home", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nav: s!.nav }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok) toast("Navigation updated", "success");
      else toast(data.error || "Failed to save", "error");
    } catch {
      toast("Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormShell title="Navigation / Header" subtitle="Show, hide and reorder the tabs in the public header. Hiding a tab only removes the menu link — the page stays reachable by direct URL." backHref={BACK}>
      <Section title="Header tabs" desc="Toggle each tab on/off. Lower order numbers appear first.">
        <div className="sm:col-span-2 space-y-2">
          {DEFAULT_NAV_TABS.map((tab, i) => {
            const o = get(tab.href);
            const visible = o.visible !== false;
            return (
              <div key={tab.href} className="grid grid-cols-[auto_1fr_90px] items-center gap-3 rounded-xl border border-line p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={visible} onChange={(e) => setOverride(tab.href, { visible: e.target.checked })} />
                  {visible ? "On" : "Off"}
                </label>
                <div>
                  <div className="font-medium">{tab.label}</div>
                  <div className="text-xs text-muted">{tab.href}</div>
                </div>
                <div>
                  <input
                    type="number"
                    className="input"
                    value={o.order ?? i}
                    onChange={(e) => setOverride(tab.href, { order: Number(e.target.value) })}
                    aria-label={`${tab.label} order`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <FormActions saving={saving} onSave={save} cancelHref={BACK} saveLabel="Save Navigation" />
    </FormShell>
  );
}
