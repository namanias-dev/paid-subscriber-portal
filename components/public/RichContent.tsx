/**
 * Renders pre-sanitized rich HTML with the shared `.rich` typography.
 * HTML is sanitized server-side (buildLandingView / API route) before reaching
 * here, so no DOMPurify is pulled into the public bundle.
 */
export default function RichContent({ html, className = "" }: { html?: string | null; className?: string }) {
  if (!html || !html.trim()) return null;
  return <div className={`rich ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
