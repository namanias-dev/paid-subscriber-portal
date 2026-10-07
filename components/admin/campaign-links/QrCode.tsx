"use client";

import { useEffect, useState } from "react";

/** Renders a QR code for `value` using the bundled, dependency-safe `qrcode` lib. */
export default function QrCode({ value, size = 160 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!value) { setDataUrl(null); return; }
    import("qrcode")
      .then((QR) => QR.toDataURL(value, { width: size, margin: 1 }))
      .then((url) => { if (alive) setDataUrl(url); })
      .catch(() => { if (alive) setDataUrl(null); });
    return () => { alive = false; };
  }, [value, size]);

  if (!dataUrl) {
    return <div className="rounded-xl bg-surface2" style={{ width: size, height: size }} aria-hidden />;
  }
  return (
    <img
      src={dataUrl}
      alt="QR code for campaign link"
      width={size}
      height={size}
      className="rounded-xl border border-line bg-white"
    />
  );
}
