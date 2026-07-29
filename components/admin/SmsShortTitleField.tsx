"use client";

/**
 * Additive SMS-only short title editor. Does not touch public title/slug.
 * Prefills from auto-shorten(fullTitle); admin can override. Live char count
 * + GSM-7 check against the registered DLT free-text max.
 */
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Field } from "./FormKit";
import {
  DLT_FREE_TEXT_VAR_MAX,
  isGsm7Text,
  resolveSmsItemShort,
  shortenSmsTitle,
} from "@/lib/sms/smsTitle";
import { analyzeBody } from "@/lib/sms/templates";

const ABANDONED_BODY =
  "Hi {first_name}, your payment for the course fee of {item_short} is pending. Login: {login_url} Code: {login_code} to complete payment. Naman Sharma IAS Academy.";

export function SmsShortTitleField(props: {
  fullTitle: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { fullTitle, value, onChange } = props;
  const auto = useMemo(() => shortenSmsTitle(fullTitle || ""), [fullTitle]);
  const [touched, setTouched] = useState(false);

  // Prefill auto value when the field is still empty / mirrors previous auto.
  useEffect(() => {
    if (!touched && !value.trim() && auto) onChange(auto);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when title-driven auto changes
  }, [auto]);

  const effective = (value.trim() || auto || "").trim();
  const len = [...effective].length;
  const over = len > DLT_FREE_TEXT_VAR_MAX;
  const gsm = isGsm7Text(effective);
  const preview = useMemo(() => {
    const item = resolveSmsItemShort({ smsShortTitle: value || null, fullTitle });
    const text = ABANDONED_BODY
      .replace("{first_name}", "Test")
      .replace("{item_short}", item)
      .replace("{login_url}", "https://www.namanias.com/login")
      .replace("{login_code}", "TESTCODE");
    const a = analyzeBody(text);
    return { item, text, ...a };
  }, [value, fullTitle]);

  return (
    <SectionBlock>
      <Field
        label="SMS short title"
        hint={`SMS-only. Website title, slug and URL stay unchanged. Max ${DLT_FREE_TEXT_VAR_MAX} chars · GSM-7.`}
      >
        <input
          className="input font-mono text-sm"
          value={value}
          onChange={(e) => {
            setTouched(true);
            onChange(e.target.value);
          }}
          placeholder={auto || "Auto from title"}
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
          <span className={over ? "font-semibold text-danger" : "text-muted"}>
            {len} / {DLT_FREE_TEXT_VAR_MAX} chars
          </span>
          <span className={gsm ? "text-success" : "font-semibold text-danger"}>
            {gsm ? "GSM-7" : "NOT GSM-7 (UCS-2 risk)"}
          </span>
          {auto && value.trim() !== auto && (
            <button
              type="button"
              className="text-brand underline"
              onClick={() => {
                setTouched(true);
                onChange(auto);
              }}
            >
              Reset to auto ({auto.length} chars)
            </button>
          )}
        </div>
        {over && (
          <p className="mt-1 text-xs text-danger">
            Over the DLT variable max — will be auto-clamped at send, but edit it down so the year stays intact.
          </p>
        )}
      </Field>
      <div className="mt-3 rounded-lg border border-border bg-surface/60 p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Live SMS preview (Abandoned Nudge)</p>
        <p className="mt-1 whitespace-pre-wrap font-mono text-xs text-ink">{preview.text}</p>
        <p className="mt-2 text-xs text-muted">
          {preview.length} chars · {preview.segments} segment{preview.segments === 1 ? "" : "s"} ·{" "}
          <span className={preview.gsm ? "text-success" : "text-danger font-semibold"}>
            {preview.gsm ? "GSM-7" : "UCS-2"}
          </span>
          {" · "}item_short = <code className="font-mono">{preview.item}</code> ({[...preview.item].length})
        </p>
      </div>
    </SectionBlock>
  );
}

function SectionBlock({ children }: { children: ReactNode }) {
  return <div className="space-y-2">{children}</div>;
}
