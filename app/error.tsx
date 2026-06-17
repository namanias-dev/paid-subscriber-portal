"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="mb-3 text-4xl">⚠️</div>
      <h1 className="font-heading text-2xl text-text">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        An unexpected error occurred. Please try again.
      </p>
      <button onClick={reset} className="btn-gold mt-5">
        Try again
      </button>
    </div>
  );
}
