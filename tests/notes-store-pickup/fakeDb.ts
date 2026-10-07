/**
 * Minimal in-memory stand-in for the Supabase query builder used by store code.
 * Each update applies its filters and writes atomically (like one Postgres statement),
 * so concurrent callers race exactly as conditional updates do in production.
 */
type Row = Record<string, unknown>;

export function fakeDb(seed: Record<string, Row[]> = {}, opts: { failSelect?: boolean } = {}) {
  const tables = new Map<string, Row[]>(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const calls: Array<{ table: string; op: string }> = [];
  function table(name: string): Row[] {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  }
  function builder(name: string) {
    let op: "select" | "update" | "insert" = "select";
    let patch: Row | null = null;
    const filters: Array<(row: Row) => boolean> = [];
    let single = false;
    const api: Record<string, unknown> = {
      select() {
        return api;
      },
      update(p: Row) {
        op = "update";
        patch = p;
        return api;
      },
      insert(row: Row | Row[]) {
        op = "insert";
        const rows = Array.isArray(row) ? row : [row];
        calls.push({ table: name, op: "insert" });
        table(name).push(...rows.map((r) => ({ ...r })));
        return Promise.resolve({ data: rows, error: null });
      },
      eq(key: string, value: unknown) {
        filters.push((row) => row[key] === value);
        return api;
      },
      in(key: string, values: unknown[]) {
        filters.push((row) => values.includes(row[key]));
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      maybeSingle() {
        single = true;
        return api;
      },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        try {
          calls.push({ table: name, op });
          if (op === "select" && opts.failSelect) return resolve({ data: null, error: { message: "read failed" } });
          const matched = table(name).filter((row) => filters.every((f) => f(row)));
          if (op === "update" && patch) {
            for (const row of matched) Object.assign(row, patch);
            return resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
          }
          return resolve({ data: single ? matched[0] || null : matched, error: null });
        } catch (error) {
          reject(error);
        }
      },
    };
    return api;
  }
  return {
    client: { from: (name: string) => builder(name) } as never,
    rows: (name: string) => table(name),
    calls,
  };
}
