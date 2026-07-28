"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { track } from "./analytics";
import type { EventName } from "@/lib/analytics/events";

/**
 * A real anchor that reports a click.
 *
 * This is a client component, but its MARKUP is still server-rendered: the href
 * and the link text are present in the initial HTML, so crawlers and a
 * JS-disabled browser see a working link, and the analytics call is the only part
 * that needs hydration. That ordering is deliberate — the CTA must be usable
 * before any of this page's JavaScript has run.
 *
 * External hrefs (`http…`, `mailto:`, `tel:`, `wa.me`) fall through to a plain
 * `<a>` with the correct rel, because next/link would otherwise try to
 * client-navigate them.
 */
export interface TrackedLinkProps {
  href: string;
  event: EventName;
  props?: Record<string, string | number | boolean | null>;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  /** Force a new tab (external targets do this automatically). */
  newTab?: boolean;
}

function isExternal(href: string): boolean {
  return /^(https?:|mailto:|tel:|\/\/)/i.test(href);
}

export default function TrackedLink({ href, event, props = {}, className, children, ariaLabel, newTab }: TrackedLinkProps) {
  const onClick = () => track(event, props);
  const external = isExternal(href);

  if (external || newTab) {
    return (
      <a
        href={href}
        className={className}
        aria-label={ariaLabel}
        onClick={onClick}
        {...(external || newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={className} aria-label={ariaLabel} onClick={onClick}>
      {children}
    </Link>
  );
}
