export default function Loading() {
  return (
    <div>
      <div className="ca-dark ca-grain relative overflow-hidden">
        <div className="container-wide py-16">
          <div className="h-3 w-40 rounded-full bg-[rgba(255,255,255,0.12)]" />
          <div className="mt-5 h-10 w-3/4 max-w-2xl rounded-xl bg-[rgba(255,255,255,0.1)]" />
          <div className="mt-3 h-5 w-1/2 max-w-md rounded-lg bg-[rgba(255,255,255,0.08)]" />
          <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="ca-glass h-32" />
            ))}
          </div>
        </div>
      </div>
      <div className="container-wide py-12">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="ca-skeleton h-72" />
          ))}
        </div>
      </div>
    </div>
  );
}
