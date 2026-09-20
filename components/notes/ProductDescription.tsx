import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a product's long description (`description_md`) on the PDP.
 *
 * Server component: the markdown is static catalogue content, so rendering it on
 * the server keeps the ISR page free of client JS. react-markdown v9 does not
 * render raw HTML unless a rehype-raw plugin is added, so admin-authored copy
 * cannot inject markup — no dangerouslySetInnerHTML, no sanitiser needed here.
 *
 * Styled with the Academy navy palette (not the admin/portal `--primary` blue)
 * so it reads as the same premium storefront as the rest of `/notes`.
 */
const components = {
  h2: (p: any) => <h2 className="mb-2 mt-6 font-heading text-lg font-bold text-[var(--ca-navy)]" {...p} />,
  h3: (p: any) => <h3 className="mb-1 mt-4 font-heading text-base font-semibold text-[var(--ca-navy)]" {...p} />,
  p: (p: any) => <p className="mb-3 text-sm leading-relaxed text-[var(--ca-navy)]/70" {...p} />,
  ul: (p: any) => <ul className="mb-3 ml-5 list-disc space-y-1 text-sm text-[var(--ca-navy)]/70" {...p} />,
  ol: (p: any) => <ol className="mb-3 ml-5 list-decimal space-y-1 text-sm text-[var(--ca-navy)]/70" {...p} />,
  li: (p: any) => <li className="leading-relaxed" {...p} />,
  strong: (p: any) => <strong className="font-semibold text-[var(--ca-navy)]" {...p} />,
  em: (p: any) => <em className="italic" {...p} />,
  a: (p: any) => <a className="font-medium text-[var(--ca-navy)] underline" {...p} />,
  blockquote: (p: any) => (
    <blockquote className="mb-3 border-l-2 border-[var(--ca-gold,#d4af37)] pl-3 text-sm italic text-[var(--ca-navy)]/65" {...p} />
  ),
  hr: () => <hr className="my-5 border-[var(--ca-navy)]/10" />,
};

export default function ProductDescription({ markdown, title = "About these notes" }: { markdown: string; title?: string }) {
  const value = (markdown || "").trim();
  if (!value) return null;
  return (
    <div className="mt-8">
      <h2 className="font-heading text-xl font-bold text-[var(--ca-navy)]">{title}</h2>
      <div className="mt-3">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {value}
        </ReactMarkdown>
      </div>
    </div>
  );
}
