"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
  type ReactNode,
} from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Link2,
  List,
  ListOrdered,
  Quote,
  Code2,
  EyeOff,
  Image as ImageIcon,
  Save,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";

/** Hardcoded client defaults — mirror lib/telegram/compose TELEGRAM_VARS (avoid server import). */
export const COMPOSER_VARS = [
  { key: "first_name", fallback: "there" },
  { key: "name", fallback: "there" },
  { key: "course", fallback: "your course" },
  { key: "course_link_1", fallback: "https://www.namanias.com/courses" },
  { key: "course_link_2", fallback: "https://www.namanias.com/courses" },
  { key: "webinar_link", fallback: "https://www.namanias.com/webinars" },
  { key: "webinar_date", fallback: "soon" },
  { key: "amount", fallback: "" },
  { key: "coupon", fallback: "" },
] as const;

export type ComposerButton = {
  label: string;
  url?: string;
  callback_data?: string;
  option_key?: string;
};

export type ComposerPoll = {
  question: string;
  options: string[];
  is_anonymous: boolean;
  allows_multiple: boolean;
};

export type ComposerValue = {
  body: string;
  imageUrl: string;
  buttons: ComposerButton[];
  fallbacks: Record<string, string>;
  templateId: string | null;
  kind: "message" | "poll" | "question";
  poll?: ComposerPoll | null;
  questionKey?: string;
  leadField?: string;
};

export type TelegramComposerHandle = {
  focus: () => void;
  getSelection: () => { start: number; end: number };
  insertAtCursor: (text: string) => void;
};

export type PreviewRecipient = {
  chatId: string;
  label: string;
};

type TemplateRow = {
  id: string;
  name: string;
  body?: string;
  image_url?: string | null;
  buttons?: ComposerButton[] | null;
  fallbacks?: Record<string, string> | null;
};

const TEXT_LIMIT = 4096;
const CAPTION_LIMIT = 1024;
const LEAD_FIELDS = [
  { id: "", label: "(none)" },
  { id: "target_year", label: "target_year" },
  { id: "preferred_batch", label: "preferred_batch" },
  { id: "course_interest", label: "course_interest" },
] as const;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function emptyComposerValue(partial?: Partial<ComposerValue>): ComposerValue {
  return {
    body: "",
    imageUrl: "",
    buttons: [{ label: "", url: "" }, { label: "", url: "" }, { label: "", url: "" }],
    fallbacks: Object.fromEntries(COMPOSER_VARS.map((v) => [v.key, v.fallback])),
    templateId: null,
    kind: "message",
    poll: null,
    questionKey: "",
    leadField: "",
    ...partial,
  };
}

export function padComposerButtons(btns?: ComposerButton[] | null): ComposerButton[] {
  const base: ComposerButton[] = [...(btns || [])].slice(0, 3).map((b) => ({
    label: b.label || "",
    url: b.url || "",
    callback_data: b.callback_data,
    option_key: b.option_key || "",
  }));
  while (base.length < 3) base.push({ label: "", url: "", option_key: "" });
  return base;
}

export function trimComposerButtons(btns: ComposerButton[], kind: ComposerValue["kind"]): ComposerButton[] {
  return btns
    .filter((b) => {
      if (!b.label.trim()) return false;
      if (kind === "message") return !!(b.url || "").trim();
      if (kind === "question") return true;
      return false;
    })
    .slice(0, 3)
    .map((b) => {
      if (kind === "question") {
        return {
          label: b.label.trim(),
          option_key: (b.option_key || "").trim() || undefined,
        };
      }
      return { label: b.label.trim(), url: (b.url || "").trim() };
    });
}

function extractUsedVars(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body || ""))) {
    if (!seen.has(m[1]!)) {
      seen.add(m[1]!);
      out.push(m[1]!);
    }
  }
  return out;
}

function plainLen(html: string): number {
  return String(html || "").replace(/<[^>]+>/g, "").length;
}

function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
): { next: string; selStart: number; selEnd: number } {
  const selected = value.slice(start, end) || "text";
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  const selStart = start + before.length;
  const selEnd = selStart + selected.length;
  return { next, selStart, selEnd };
}

function wrapLines(
  value: string,
  start: number,
  end: number,
  ordered: boolean,
): { next: string; selStart: number; selEnd: number } {
  const selected = value.slice(start, end) || "item";
  const lines = selected.split(/\n/);
  const wrapped = lines
    .map((l, i) => {
      const t = l.trim() || "item";
      return ordered ? `${i + 1}. ${t}` : `• ${t}`;
    })
    .join("\n");
  const next = value.slice(0, start) + wrapped + value.slice(end);
  return { next, selStart: start, selEnd: start + wrapped.length };
}

type Props = {
  value: ComposerValue;
  onChange: (v: ComposerValue) => void;
  disabled?: boolean;
  mode?: "broadcast" | "direct";
  /** Optional sample recipients for live preview */
  recipients?: PreviewRecipient[];
  onRequestRecipients?: () => void;
};

const TelegramComposer = forwardRef<TelegramComposerHandle, Props>(function TelegramComposer(
  { value, onChange, disabled, mode = "broadcast", recipients = [], onRequestRecipients },
  ref,
) {
  const { toast } = useToast();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [tplBusy, setTplBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [fallbacksOpen, setFallbacksOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewMissing, setPreviewMissing] = useState<string[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewChatId, setPreviewChatId] = useState("");
  const [newTplName, setNewTplName] = useState("");

  const patch = useCallback(
    (p: Partial<ComposerValue>) => onChange({ ...value, ...p }),
    [onChange, value],
  );

  const insertAtCursor = useCallback(
    (text: string) => {
      const el = taRef.current;
      if (!el || disabled) return;
      const start = el.selectionStart ?? value.body.length;
      const end = el.selectionEnd ?? start;
      const next = value.body.slice(0, start) + text + value.body.slice(end);
      patch({ body: next });
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + text.length;
        el.setSelectionRange(pos, pos);
      });
    },
    [disabled, patch, value.body],
  );

  useImperativeHandle(
    ref,
    () => ({
      focus: () => taRef.current?.focus(),
      getSelection: () => ({
        start: taRef.current?.selectionStart ?? 0,
        end: taRef.current?.selectionEnd ?? 0,
      }),
      insertAtCursor,
    }),
    [insertAtCursor],
  );

  useEffect(() => {
    fetch("/api/admin/telegram/templates")
      .then((r) => r.json())
      .then((d) => setTemplates(Array.isArray(d?.templates) ? d.templates : []))
      .catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    if (recipients.length && !previewChatId) {
      setPreviewChatId(recipients[0]!.chatId);
    }
  }, [recipients, previewChatId]);

  const usedVars = extractUsedVars(value.body);
  const hasImage = !!value.imageUrl.trim();
  const limit = hasImage ? CAPTION_LIMIT : TEXT_LIMIT;
  const chars = plainLen(value.body);
  const overLimit = chars > limit;

  function applyWrap(tag: "b" | "i" | "s" | "tg-spoiler" | "code" | "blockquote") {
    const el = taRef.current;
    if (!el || disabled) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const open = tag === "tg-spoiler" ? "<tg-spoiler>" : `<${tag}>`;
    const close = tag === "tg-spoiler" ? "</tg-spoiler>" : `</${tag}>`;
    const { next, selStart, selEnd } = wrapSelection(value.body, start, end, open, close);
    patch({ body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }

  function applyLink() {
    const el = taRef.current;
    if (!el || disabled) return;
    const url = window.prompt("Link URL", "https://");
    if (!url) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const safe = url.replace(/"/g, "&quot;");
    const { next, selStart, selEnd } = wrapSelection(value.body, start, end, `<a href="${safe}">`, "</a>");
    patch({ body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }

  function applyList(ordered: boolean) {
    const el = taRef.current;
    if (!el || disabled) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const { next, selStart, selEnd } = wrapLines(value.body, start, end, ordered);
    patch({ body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }

  function loadTemplate(id: string) {
    if (!id) {
      patch({ templateId: null });
      return;
    }
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    const fb = { ...Object.fromEntries(COMPOSER_VARS.map((v) => [v.key, v.fallback])), ...(t.fallbacks || {}) };
    patch({
      templateId: t.id,
      body: t.body || "",
      imageUrl: t.image_url || "",
      buttons: padComposerButtons(t.buttons),
      fallbacks: fb,
    });
    setNewTplName(t.name || "");
  }

  async function saveAsNewTemplate() {
    if (disabled) return;
    const name = newTplName.trim() || window.prompt("Template name");
    if (!name) return;
    setTplBusy(true);
    const d = await fetch("/api/admin/telegram/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        body: value.body,
        image_url: value.imageUrl.trim() || null,
        buttons: trimComposerButtons(value.buttons, "message"),
        fallbacks: value.fallbacks,
      }),
    })
      .then((r) => r.json())
      .catch(() => null);
    setTplBusy(false);
    if (d?.ok && d.template) {
      toast("Template saved.", "success");
      setTemplates((prev) => [d.template, ...prev.filter((t) => t.id !== d.template.id)]);
      patch({ templateId: d.template.id });
      setNewTplName(d.template.name || name);
    } else {
      toast(d?.error || "Could not save template", "error");
    }
  }

  async function updateTemplate() {
    if (disabled || !value.templateId) {
      toast("Select a template to update", "error");
      return;
    }
    setTplBusy(true);
    const d = await fetch("/api/admin/telegram/templates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: value.templateId,
        name: newTplName.trim() || undefined,
        body: value.body,
        image_url: value.imageUrl.trim() || null,
        buttons: trimComposerButtons(value.buttons, "message"),
        fallbacks: value.fallbacks,
      }),
    })
      .then((r) => r.json())
      .catch(() => null);
    setTplBusy(false);
    if (d?.ok && d.template) {
      toast("Template updated.", "success");
      setTemplates((prev) => prev.map((t) => (t.id === d.template.id ? d.template : t)));
    } else {
      toast(d?.error || "Could not update template", "error");
    }
  }

  async function uploadImage(file: File) {
    setUploadBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", "telegram");
    const d = await fetch("/api/admin/upload", { method: "POST", body: fd })
      .then((r) => r.json())
      .catch(() => null);
    setUploadBusy(false);
    if (d?.ok && d.url) {
      patch({ imageUrl: d.url });
      toast("Image uploaded.", "success");
    } else {
      toast(d?.error || "Upload failed — paste a public URL instead.", "error");
    }
  }

  async function runPreview() {
    setPreviewBusy(true);
    setPreviewErr(null);
    setPreviewMissing([]);
    const d = await fetch("/api/admin/telegram/broadcast/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: value.body,
        fallbacks: value.fallbacks,
        imageUrl: value.imageUrl.trim() || null,
        image: value.imageUrl.trim() || null,
        chatId: previewChatId || undefined,
        kind: value.kind,
        poll: value.poll,
        questionKey: value.questionKey,
        leadField: value.leadField,
        buttons: trimComposerButtons(value.buttons, value.kind),
      }),
    })
      .then((r) => r.json())
      .catch(() => null);
    setPreviewBusy(false);
    if (!d?.ok) {
      setPreviewHtml("");
      setPreviewErr(d?.error || "Preview API unavailable — check body locally.");
      // Client-side fallback: crude escape + var replace with fallbacks
      let html = value.body;
      for (const [k, fb] of Object.entries(value.fallbacks)) {
        html = html.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), fb || "");
      }
      html = html.replace(/\{\{[^}]*\}\}/g, "");
      setPreviewHtml(html.replace(/\n/g, "<br/>"));
      return;
    }
    setPreviewHtml(d.html || d.rendered || d.body || "");
    setPreviewMissing(Array.isArray(d.missingVars) ? d.missingVars : d.missing || []);
  }

  useEffect(() => {
    if (!value.body.trim()) {
      setPreviewHtml("");
      return;
    }
    const t = window.setTimeout(() => {
      void runPreview();
    }, 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on content/chat
  }, [value.body, value.fallbacks, value.imageUrl, value.kind, previewChatId]);

  function setKind(kind: ComposerValue["kind"]) {
    if (kind === "poll") {
      patch({
        kind,
        poll: value.poll || {
          question: value.body.slice(0, 300) || "",
          options: ["Option A", "Option B"],
          is_anonymous: true,
          allows_multiple: false,
        },
      });
    } else if (kind === "question") {
      patch({
        kind,
        questionKey: value.questionKey || "q1",
        buttons: padComposerButtons(value.buttons).map((b, i) => ({
          ...b,
          option_key: b.option_key || `opt_${i + 1}`,
          url: "",
        })),
      });
    } else {
      patch({ kind: "message" });
    }
  }

  function updateButton(i: number, p: Partial<ComposerButton>) {
    const next = padComposerButtons(value.buttons);
    next[i] = { ...next[i]!, ...p };
    patch({ buttons: next });
  }

  function updatePoll(p: Partial<ComposerPoll>) {
    const poll = value.poll || {
      question: "",
      options: ["", ""],
      is_anonymous: true,
      allows_multiple: false,
    };
    patch({ poll: { ...poll, ...p } });
  }

  const showMessageExtras = value.kind === "message" || value.kind === "question";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {(["message", "poll", "question"] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => setKind(k)}
            className={`pill text-xs capitalize ${value.kind === k ? "pill-blue" : "pill-gray"}`}
          >
            {k}
          </button>
        ))}
        {mode === "direct" && <span className="pill pill-gray text-[10px]">Direct</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted">Template</span>
          <select
            className="input"
            disabled={disabled}
            value={value.templateId || ""}
            onChange={(e) => loadTemplate(e.target.value)}
          >
            <option value="">— Blank / custom —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            className="input w-40 text-xs"
            placeholder="Template name"
            disabled={disabled}
            value={newTplName}
            onChange={(e) => setNewTplName(e.target.value)}
          />
          <button type="button" className="btn btn-secondary text-xs" disabled={disabled || tplBusy} onClick={saveAsNewTemplate}>
            <Save size={12} /> Save as new
          </button>
          <button
            type="button"
            className="btn btn-secondary text-xs"
            disabled={disabled || tplBusy || !value.templateId}
            onClick={updateTemplate}
          >
            Update template
          </button>
        </div>
      </div>

      {value.kind === "poll" && value.poll && (
        <div className="card space-y-3 p-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">Poll question</span>
            <input
              className="input"
              disabled={disabled}
              value={value.poll.question}
              onChange={(e) => updatePoll({ question: e.target.value })}
              maxLength={300}
            />
          </label>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">Options (2–10)</p>
            {value.poll.options.map((opt, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input flex-1"
                  disabled={disabled}
                  value={opt}
                  onChange={(e) => {
                    const options = [...value.poll!.options];
                    options[i] = e.target.value;
                    updatePoll({ options });
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  disabled={disabled || value.poll!.options.length <= 2}
                  onClick={() => updatePoll({ options: value.poll!.options.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
            ))}
            {value.poll.options.length < 10 && (
              <button
                type="button"
                className="btn btn-secondary text-xs"
                disabled={disabled}
                onClick={() => updatePoll({ options: [...value.poll!.options, `Option ${value.poll!.options.length + 1}`] })}
              >
                Add option
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                disabled={disabled}
                checked={value.poll.is_anonymous}
                onChange={(e) => updatePoll({ is_anonymous: e.target.checked })}
              />
              Anonymous
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                disabled={disabled}
                checked={value.poll.allows_multiple}
                onChange={(e) => updatePoll({ allows_multiple: e.target.checked })}
              />
              Allow multiple
            </label>
          </div>
        </div>
      )}

      {value.kind === "question" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">question_key</span>
            <input
              className="input font-mono text-xs"
              disabled={disabled}
              value={value.questionKey || ""}
              onChange={(e) => patch({ questionKey: e.target.value })}
              placeholder="e.g. target_year_q"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">Lead field (optional)</span>
            <select
              className="input"
              disabled={disabled}
              value={value.leadField || ""}
              onChange={(e) => patch({ leadField: e.target.value })}
            >
              {LEAD_FIELDS.map((f) => (
                <option key={f.id || "none"} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {showMessageExtras && (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  { tip: "Bold", icon: Bold, fn: () => applyWrap("b") },
                  { tip: "Italic", icon: Italic, fn: () => applyWrap("i") },
                  { tip: "Strike", icon: Strikethrough, fn: () => applyWrap("s") },
                  { tip: "Spoiler", icon: EyeOff, fn: () => applyWrap("tg-spoiler") },
                  { tip: "Link", icon: Link2, fn: applyLink },
                  { tip: "Bullets", icon: List, fn: () => applyList(false) },
                  { tip: "Numbered", icon: ListOrdered, fn: () => applyList(true) },
                  { tip: "Quote", icon: Quote, fn: () => applyWrap("blockquote") },
                  { tip: "Code", icon: Code2, fn: () => applyWrap("code") },
                ] as { tip: string; icon: typeof Bold; fn: () => void }[]
              ).map(({ tip, icon: Icon, fn }) => (
                <button
                  key={tip}
                  type="button"
                  title={tip}
                  disabled={disabled}
                  className="btn btn-secondary px-2 py-1 text-xs"
                  onClick={fn}
                >
                  <Icon size={13} />
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {COMPOSER_VARS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  disabled={disabled}
                  className="pill pill-gray cursor-pointer text-[11px] hover:opacity-80"
                  onClick={() => insertAtCursor(`{{${v.key}}}`)}
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
            <textarea
              ref={taRef}
              className="input min-h-[140px] font-mono text-sm"
              disabled={disabled}
              value={value.body}
              onChange={(e) => patch({ body: e.target.value })}
              placeholder="Hi {{first_name}}, …"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className={overLimit ? "font-semibold text-danger" : "text-muted"}>
                {chars}/{limit}
                {hasImage ? " (caption with image)" : " (text)"}
              </span>
              {overLimit && (
                <span className="inline-flex items-center gap-1 text-danger">
                  <AlertTriangle size={12} /> Over Telegram limit
                </span>
              )}
            </div>
          </div>

          {usedVars.length > 0 && (
            <div className="rounded-xl border border-line">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted"
                onClick={() => setFallbacksOpen((o) => !o)}
              >
                Fallbacks for used vars ({usedVars.length})
                {fallbacksOpen ? <ChevronUp size={14} className="ml-auto" /> : <ChevronDown size={14} className="ml-auto" />}
              </button>
              {fallbacksOpen && (
                <div className="grid gap-2 border-t border-line p-3 sm:grid-cols-2">
                  {usedVars.map((k) => (
                    <label key={k} className="block text-sm">
                      <span className="mb-1 block font-mono text-[11px] text-muted">{`{{${k}}}`}</span>
                      <input
                        className="input text-xs"
                        disabled={disabled}
                        value={value.fallbacks[k] ?? ""}
                        onChange={(e) =>
                          patch({ fallbacks: { ...value.fallbacks, [k]: e.target.value } })
                        }
                        placeholder={COMPOSER_VARS.find((v) => v.key === k)?.fallback ?? ""}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-muted">Image URL (optional)</span>
              <div className="flex flex-wrap gap-2">
                <input
                  className="input min-w-[12rem] flex-1"
                  disabled={disabled}
                  value={value.imageUrl}
                  onChange={(e) => patch({ imageUrl: e.target.value })}
                  placeholder="https://…"
                />
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  disabled={disabled || uploadBusy}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImageIcon size={13} /> {uploadBusy ? "…" : "Upload"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadImage(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </label>
            {value.imageUrl.trim() && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={value.imageUrl.trim()}
                alt=""
                className="max-h-40 rounded-lg border border-line object-contain"
              />
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted">
              Inline buttons (up to 3)
              {value.kind === "question" ? " — label + option_key (callback server-side)" : " — label + URL"}
            </p>
            {padComposerButtons(value.buttons).map((b, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <input
                  className="input"
                  placeholder={`Button ${i + 1} label`}
                  disabled={disabled}
                  value={b.label}
                  onChange={(e) => updateButton(i, { label: e.target.value })}
                />
                {value.kind === "question" ? (
                  <input
                    className="input font-mono text-xs"
                    placeholder="option_key"
                    disabled={disabled}
                    value={b.option_key || ""}
                    onChange={(e) => updateButton(i, { option_key: e.target.value })}
                  />
                ) : (
                  <input
                    className="input"
                    placeholder="https://…"
                    disabled={disabled}
                    value={b.url || ""}
                    onChange={(e) => updateButton(i, { url: e.target.value })}
                  />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">Live preview</p>
          <button type="button" className="btn btn-secondary ml-auto text-xs" disabled={previewBusy} onClick={() => void runPreview()}>
            <RefreshCw size={12} className={previewBusy ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-[10rem] flex-1 text-sm">
            <span className="mb-1 block text-xs font-medium text-muted">Preview as recipient</span>
            <select
              className="input"
              value={previewChatId}
              onChange={(e) => setPreviewChatId(e.target.value)}
            >
              <option value="">Sample / fallbacks only</option>
              {recipients.map((r) => (
                <option key={r.chatId} value={r.chatId}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          {onRequestRecipients && (
            <button type="button" className="btn btn-secondary text-xs" onClick={onRequestRecipients}>
              Load sample
            </button>
          )}
        </div>
        {previewErr && (
          <p className="text-xs text-amber-800">
            <AlertTriangle size={12} className="mr-1 inline" />
            {previewErr}
          </p>
        )}
        {previewMissing.length > 0 && (
          <p className="text-xs text-amber-800">
            Missing vars (using fallbacks): {previewMissing.join(", ")}
          </p>
        )}
        <div className="mx-auto max-w-sm rounded-2xl bg-[#0e1621] p-3 shadow-inner">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[#6d8da6]">Telegram preview</div>
          {value.imageUrl.trim() && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value.imageUrl.trim()} alt="" className="mb-2 max-h-36 w-full rounded-lg object-cover" />
          )}
          {value.kind === "poll" && value.poll ? (
            <div className="rounded-xl rounded-tl-sm bg-[#182533] px-3 py-2 text-sm text-[#e4ecf2]">
              <p className="font-semibold">{value.poll.question || "(poll question)"}</p>
              <ul className="mt-2 space-y-1">
                {value.poll.options.map((o, i) => (
                  <li key={i} className="rounded-lg border border-[#2b5278] px-2 py-1 text-xs">
                    {o || `Option ${i + 1}`}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div
              className="tg-preview-bubble rounded-xl rounded-tl-sm bg-[#182533] px-3 py-2 text-sm leading-relaxed text-[#e4ecf2] [&_a]:text-[#6ab3f3] [&_blockquote]:border-l-2 [&_blockquote]:border-[#2b5278] [&_blockquote]:pl-2 [&_code]:rounded [&_code]:bg-[#0e1621] [&_code]:px-1"
              dangerouslySetInnerHTML={{ __html: previewHtml || "<span style='opacity:.5'>(empty)</span>" }}
            />
          )}
          {value.kind === "question" && (
            <div className="mt-2 flex flex-col gap-1">
              {trimComposerButtons(value.buttons, "question").map((b, i) => (
                <span key={i} className="rounded-lg bg-[#2b5278] px-2 py-1 text-center text-xs text-white">
                  {b.label}
                </span>
              ))}
            </div>
          )}
          {value.kind === "message" && trimComposerButtons(value.buttons, "message").length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {trimComposerButtons(value.buttons, "message").map((b, i) => (
                <span key={i} className="rounded-lg bg-[#2b5278] px-2 py-1 text-center text-xs text-white">
                  {b.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export default TelegramComposer;

/** Tiny helper for Mission Control Field wrappers */
export function ComposerField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
