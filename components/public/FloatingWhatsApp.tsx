"use client";

import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";

/** Path prefixes where the floating support button should appear. */
const ALLOWED_PREFIXES = ["/courses", "/webinars", "/portal"];

/**
 * Persistent WhatsApp support button. The wa.me link is resolved server-side
 * from the admin-editable site settings (same number as the Contact page) and
 * passed in, so the number is never hardcoded here.
 */
export default function FloatingWhatsApp({ waLink }: { waLink: string | null }) {
  const pathname = usePathname() || "";
  const reduce = useReducedMotion();

  const show = !!waLink && ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`) || pathname.startsWith(p));
  if (!show) return null;

  return (
    <motion.a
      href={waLink!}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
      whileHover={reduce ? undefined : { scale: 1.08 }}
      whileTap={reduce ? undefined : { scale: 0.95 }}
      className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg"
      style={{
        background: "#25D366",
        marginBottom: "env(safe-area-inset-bottom)",
        marginRight: "env(safe-area-inset-right)",
      }}
    >
      <svg viewBox="0 0 32 32" width="30" height="30" fill="#fff" aria-hidden="true">
        <path d="M16.003 3.2c-7.06 0-12.8 5.74-12.8 12.8 0 2.26.6 4.46 1.74 6.4L3.2 28.8l6.6-1.72a12.7 12.7 0 0 0 6.2 1.6h.01c7.06 0 12.8-5.74 12.8-12.8 0-3.42-1.33-6.64-3.75-9.06A12.7 12.7 0 0 0 16.003 3.2zm0 23.04h-.01a10.6 10.6 0 0 1-5.4-1.48l-.39-.23-3.92 1.03 1.05-3.82-.25-.4a10.6 10.6 0 0 1-1.62-5.64c0-5.86 4.77-10.62 10.64-10.62 2.84 0 5.51 1.11 7.52 3.12a10.56 10.56 0 0 1 3.11 7.52c0 5.86-4.77 10.62-10.63 10.62zm5.83-7.95c-.32-.16-1.89-.93-2.18-1.04-.29-.11-.5-.16-.71.16-.21.32-.82 1.04-1 1.25-.18.21-.37.24-.69.08-.32-.16-1.35-.5-2.57-1.59-.95-.85-1.59-1.9-1.78-2.22-.18-.32-.02-.49.14-.65.14-.14.32-.37.48-.55.16-.18.21-.32.32-.53.11-.21.05-.4-.03-.56-.08-.16-.71-1.72-.97-2.35-.26-.62-.52-.54-.71-.55l-.61-.01c-.21 0-.55.08-.84.4-.29.32-1.1 1.08-1.1 2.63s1.13 3.05 1.29 3.26c.16.21 2.23 3.4 5.4 4.77.75.32 1.34.51 1.8.66.76.24 1.44.21 1.98.13.6-.09 1.89-.77 2.16-1.52.27-.74.27-1.38.19-1.51-.08-.13-.29-.21-.61-.37z" />
      </svg>
    </motion.a>
  );
}
