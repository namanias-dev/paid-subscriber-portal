"use client";

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-3 text-4xl">⚠️</div>
      <h2 className="font-heading text-xl text-text">Couldn&apos;t load your dashboard</h2>
      <button onClick={reset} className="btn-gold mt-4">
        Retry
      </button>
    </div>
  );
}
