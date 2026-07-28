"use client";

import { useEffect } from "react";

/**
 * Opts a page into receipt print isolation: while this is mounted, printing
 * shows only the `.receipt-doc` / `.receipt-print` document and hides the rest
 * of the page. The rules live in globals.css behind `body.print-isolate` so
 * they cannot blank the printed output of any other page.
 */
export default function PrintIsolate() {
  useEffect(() => {
    const { body } = document;
    body.classList.add("print-isolate");
    return () => body.classList.remove("print-isolate");
  }, []);

  return null;
}
