"use client";

import { useToast } from "@/components/ui/Toast";

export default function AccessCodeBox({
  code,
  whatsappLink,
}: {
  code: string;
  whatsappLink?: string;
}) {
  const { toast } = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      toast("Code copied!", "success");
    } catch {
      toast("Copy failed", "error");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="access-code text-base">{code}</span>
      <button onClick={copy} className="btn-outline px-3 py-2 text-sm" aria-label="Copy code">
        📋 Copy
      </button>
      {whatsappLink && (
        <a
          href={whatsappLink}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-gold px-3 py-2 text-sm"
        >
          Send via WhatsApp
        </a>
      )}
    </div>
  );
}
