# Payments source pill — 4th shipment (root-cause + display widening)

Timestamp of investigation: 2026-07-24 (UTC-7).

Prior deploy records:
- `docs/naman-ai/reports/payment-source-restore.md` — `a1a35519` (payments route reads
  `lead.channel` + emits `leadAttrByPhone`).
- `docs/naman-ai/reports/payment-pill-deploystate-fix.md` — `8076c57a` (pill-map
  scale fix: `getLeadsForPillMap` + `pruneEmptyChannels`).
- `docs/naman-ai/reports/crm-fixture-fallback-fix.md` — `9f567b64` (CRM route no
  longer silently serves fixtures; legacy filter pushed to DB).

This 4th shipment is a **DISPLAY-WIDENING** fix. It does NOT overturn the prior
three fixes; it addresses the residual data-completeness gap that made the pill
render for only ~11 % of admin-Payments user rows.

PII masking: all lead/payment IDs and phone numbers are masked to bucketed counts
or `50000000xx` fake phones in test doubles. No name, real phone, or email
appears in this report. The Supabase MCP results below were reduced to aggregate
counts before being written here.

---

## 1. Ground-truth deployed prod SHA

Sampled at `2026-07-24 ~20:45 UTC`:

```bash
$ curl -s https://www.namanias.com/api/version
{"version":"9fa382c437f6"}

$ git log --oneline -1 origin/master
9fa382c4 docs(crm): fixture-fallback deploy record + planner-fix follow-up (#4)
```

- Deployed prod SHA (from `/api/version`): **`9fa382c437f6`**
- `origin/master` tip: **`9fa382c4…`** — identical prefix. The prod alias
  `www.namanias.com` is serving `origin/master` HEAD.
- Vercel MCP `list_deployments target=production` (checked in a prior session
  today) reported the top READY deployment for `naman-ias` (`prj_ULEGP…`) with
  the same `githubCommitSha`.

---

## 2. Ancestry verdict for the earlier "fixes"

```bash
$ git merge-base --is-ancestor a1a35519 origin/master && echo YES || echo NO
YES
$ git merge-base --is-ancestor 8076c57a origin/master && echo YES || echo NO
YES
$ git merge-base --is-ancestor c59c6ab9 origin/master && echo YES || echo NO
YES
$ git merge-base --is-ancestor 9f567b64 origin/master && echo YES || echo NO
YES
```

**Verdict on H1 (NEVER DEPLOYED):** falsified. The payment-source-restore
(`a1a35519`) AND the pill-map scale fix (`8076c57a`) ARE both live on prod
(`9fa382c4…`). The 3rd shipment (`9f567b64`, CRM fixture-fallback + DB-side
legacy filter) is also live.

The last three shipments did land in prod. The pill is still missing on most
rows for a different reason — see §3.

---

## 3. Read-only diagnosis — H2 / H3 / normalization

### 3.1 Code path (unchanged since `8076c57a`)

```213:281:lib/dataProvider.ts (excerpt from getLeadsForPillMap)
export async function getLeadsForPillMap(): Promise<Lead[]> {
  // (a) Non-legacy universe (~1.3k today) — full set is needed to preserve
  //     the collision-preference rule.
  const nonLegacyPromise = getLeads({ includeLegacy: false });
  // (b) Targeted legacy-with-channel slice — a couple rows in prod today.
  const legacyChanPromise = db.from("leads").select("*")
    .not("channel", "is", null)
    .neq("channel", "")
    .filter("attribution->>legacy", "eq", "true")
    .limit(5000);
  const [nonLegacy, legacyRes] = await Promise.all([nonLegacyPromise, legacyChanPromise]);
  return [...nonLegacy, ...(legacyRes.data ?? [])];
}
```

- The map is built by `buildLeadAttrByPhone` (`lib/marketing/leadAttrByPhone.ts`
  lines 184–210 pre-widening). It picks the non-legacy lead on collisions and
  never throws on `>1` matches per phone.
- `pruneEmptyChannels` (same file, lines 233–244 pre-widening) DROPS entries
  where `channel` is empty — the payload-shrink knob the scale fix added.
- Phone normalization on BOTH sides uses `normPhone` → last-10 digits
  (`lib/phone.ts`). The payments route calls `normPhone(payment.phone)` before
  looking up. Same helper is used by `buildLeadAttrByPhone` for the map keys.

**Verdict on normalization:** consistent. Both sides use last-10 digits.
No shape drift is possible in the map lookup.

**Verdict on H3 (DUPLICATE-PHONE AMBIGUITY):** already fixed by `a1a35519`
and `c59c6ab9`. `buildLeadAttrByPhone` deterministically prefers the
non-legacy row on collisions, and the collision-merge branch (`c59c6ab9`)
NEVER overwrites the scalar `channel` (touches are appended to
`attribution.legacy_touches[]` only). Regression tests in
`tests/payment-source-restore/payment-source-restore.test.ts` (test (b))
already pin this.

### 3.2 The real gap — H2 restated as data completeness

Read-only Supabase MCP against the deployed prod DB
(`xqwdfyzerzsllqiyzxem`, aggregate-only, no PII):

```sql
-- Signal coverage across non-legacy leads (attribution->>legacy IS NULL or != 'true').
SELECT
  COUNT(*)                                                        AS total_nonlegacy,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(channel),'') IS NOT NULL)    AS with_scalar_channel,
  COUNT(*) FILTER (WHERE attribution->'first_touch' IS NOT NULL)  AS with_first_touch,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(utm_source),'') IS NOT NULL) AS with_utm_source,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(source),'') IS NOT NULL)     AS with_source,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(first_source),'') IS NOT NULL) AS with_first_source,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(gclid),'') IS NOT NULL)      AS with_gclid,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(COALESCE(channel, utm_source, source, first_source, gclid, '')),'') IS NOT NULL) AS with_any_signal
FROM public.leads
WHERE (attribution IS NULL OR attribution->>'legacy' IS NULL OR attribution->>'legacy' != 'true');
```

| Column               | Count | Share  |
|----------------------|------:|-------:|
| total_nonlegacy      | 1,310 | 100 %  |
| with_scalar_channel  |   119 |  9.1 % |
| with_first_touch     |   118 |  9.0 % |
| with_utm_source      |   119 |  9.1 % |
| with_source          | 1,310 | 100 %  |
| with_first_source    |   985 | 75.2 % |
| with_gclid           |     2 |  0.2 % |
| with_any_signal      | 1,310 | 100 %  |

Every non-legacy lead has SOME source signal (100 % have `source`), but only
9.1 % have the scalar `channel` column populated. The `channel` column is only
written for leads that came through the modern attribution-capture path
(`fe1c8334` "capture full Meta + Google ad hierarchy", 2026-07-16 onward). The
other 1,191 rows carry a form `source` ("Webinar" / "quiz_public" / "home_popup"
/ "Website" / "Demo") and no scalar channel.

Distribution of the 1,191 rescuable rows (widened source only):

| Form source   |    n | Would render pill as |
|---------------|-----:|---------------------:|
| quiz_public   |  528 | Other                |
| webinar       |  518 | Other                |
| home_popup    |   69 | Other                |
| website       |   37 | Other                |
| demo          |   36 | Other                |
| meta form     |    1 | Other                |
| referral      |    1 | Referral             |
| instagram     |    1 | Organic              |

Payment-side blast radius (distinct paid phones, phones normalized to last-10
on both sides):

```sql
WITH nonlegacy AS (
  SELECT RIGHT(REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g'),10) AS p10,
         channel, utm_source, source, first_source, gclid
  FROM public.leads
  WHERE (attribution IS NULL OR attribution->>'legacy' IS NULL OR attribution->>'legacy' != 'true')
),
paid AS (
  SELECT DISTINCT RIGHT(REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','','g'),10) AS p10
  FROM public.payments
  WHERE status IN ('PAID','CAPTURED','SUCCESS','paid','captured','success')
    AND phone IS NOT NULL AND LENGTH(TRIM(phone)) > 0
)
SELECT
  COUNT(DISTINCT paid.p10)                                                                                             AS distinct_paid_phones,
  COUNT(DISTINCT paid.p10) FILTER (WHERE nl.p10 IS NOT NULL)                                                            AS paid_phones_with_any_nonlegacy_lead,
  COUNT(DISTINCT paid.p10) FILTER (WHERE nl.p10 IS NOT NULL AND NULLIF(TRIM(nl.channel),'') IS NOT NULL)                AS paid_phones_pre_fix_scalar_channel,
  COUNT(DISTINCT paid.p10) FILTER (WHERE nl.p10 IS NOT NULL
    AND NULLIF(TRIM(COALESCE(nl.channel, nl.utm_source, nl.source, nl.first_source, nl.gclid, '')),'') IS NOT NULL)     AS paid_phones_post_fix_any_signal
FROM paid LEFT JOIN nonlegacy nl ON nl.p10 = paid.p10;
```

| Column                                     | Count | Share of paid phones |
|--------------------------------------------|------:|---------------------:|
| distinct_paid_phones                       |   646 | 100 %                |
| paid_phones_with_any_nonlegacy_lead        |   443 | 68.6 %               |
| paid_phones_pre_fix_scalar_channel         |    70 | 10.8 %               |
| paid_phones_post_fix_any_signal            |   443 | 68.6 %               |

- Under the currently-deployed logic (scalar-`channel` only) a pill renders for
  70 / 646 (10.8 %) distinct paid phones. That is why "the pill is missing on
  every row" from a scanning-the-list perspective — for every 9 rows a user
  scrolls past, only 1 has any pill.
- Under the widened logic (this shipment) a pill renders for 443 / 646
  (68.6 %) — a 6.3× improvement.
- The residual 203 paid phones have no non-legacy lead at all (offline /
  legacy-imported students who never captured a lead through the modern
  funnel). Those legitimately render an empty pill — we are not fabricating a
  source for them.

**Verdict on H2 (LEGACY GUARD STARVING THE LOOKUP):** ORIGINALLY LIKELY,
already addressed. `getLeadsForPillMap` (a1a35519 + 8076c57a) includes ALL
non-legacy leads and a legacy-with-channel slice. `derivedChannelFor` still
short-circuits `legacy: true` to `Unknown` in aggregates. The residual gap is
`pruneEmptyChannels` dropping the ~87 % of non-legacy leads that carry a
form `source` but no scalar `channel` — those entries ARE in the map before
prune, but the prune drops them because the scalar `channel` is empty. That is
the "guard added later that starves the map" the task hinted at.

### 3.3 Historical git provenance for the pill

`git log --oneline` on the pill-relevant files shows the pill has ALWAYS
rendered from the scalar `channel` — the pre-8076c57a code (a1a35519) ALSO
never surfaced a pill for a null-channel lead:

```
$ git log --oneline app/api/admin/payments/route.ts \
    lib/marketing/leadAttrByPhone.ts \
    components/admin/SourcePill.tsx
9fa382c4 docs(crm): fixture-fallback deploy record + planner-fix follow-up (#4)
9f567b64 fix(crm): stop silently serving fixtures + push legacy filter to DB (#3)
19b20869 docs: payment-pill scale-fix deploy record + prod smoke evidence (#2)
8076c57a fix(payments): stop pill map from OOM'ing at 179k leads (#1)
5beae6bd docs: payment-source-restore final deploy + smoke evidence
a1a35519 fix(admin/payments): restore SourcePill on payment rows
c59c6ab9 fix(leads): guard collision-merge from clobbering attribution scalars
…
```

The user's memory of "pills used to show on every row" describes the pre-2026-07
window: at that point recent payments were tied to modern-funnel leads whose
`channel` scalar was populated. As the payment tail extended (older payments
paginated in from earlier in the year, plus the 178 k legacy-lead import
dilution) the pill coverage rate fell to ~11 % of visible rows — visually
indistinguishable from a total regression.

### 3.4 Overall verdict

The last three shipments were shipped correctly (H1 falsified). The pill logic
is correct (H3 falsified). The gap is DATA COMPLETENESS: only 9 % of
non-legacy leads have the scalar `channel` column populated, so the pill only
renders when the payment phone hits one of that thin slice. The scale-fix
`pruneEmptyChannels` guard silently dropped every source-only lead from the
map, which is why WIDENING `pruneEmptyChannels` (H2, restated) is the correct
fourth-shipment fix.

---

## 4. Fix diff (Phase 2)

Minimum-viable change: derive a `displayChannel` from the widest available
lead signal (scalar `channel` → `attribution.first_touch` → utm/form-source
fallback) and let `SourcePill` render from it. `derivedChannelFor` (aggregate
counts) continues to read the scalar `channel` ONLY, so source-card totals stay
byte-identical.

### 4.1 `lib/marketing/leadAttrByPhone.ts`

- New `LeadAttrByPhoneEntry.displayChannel` field.
- New exported `deriveDisplayChannel(l)` helper — scalar → `first_touch` →
  synthetic touch from utm/source/first_source/gclid → null.
- `buildLeadAttrByPhone` now populates `displayChannel` on every entry.
- `pruneEmptyChannels` now keeps entries with `channel` OR `displayChannel`.
- Detailed rationale in the file header (lines 37–67).

### 4.2 `app/api/admin/payments/route.ts`

- `PaymentsLeadAttr` interface adds `displayChannel: string | null`. The map is
  already `LeadAttrByPhoneEntry` under the hood — no runtime change other than
  the new field flowing through to the JSON payload.

### 4.3 `components/admin/SourcePill.tsx`

- `LeadAttrStamp.displayChannel?: string | null` added (optional to keep older
  callers compiling).
- Renders `attr.displayChannel || attr.channel` — falls back cleanly on older
  routes that don't emit `displayChannel`. Preserves branded colouring for
  `Meta Ads` and `Google Ads`; everything else uses the neutral style.

### 4.4 `app/api/admin/students/[id]/route.ts`

- `leadAttribution` payload now includes `displayChannel: deriveDisplayChannel(attributionLead)`.
  Same widening applies to the individual-student pill.

### 4.5 `lib/types.ts`

- `LeadForSourceAttr` (via the `Pick` in `leadAttrByPhone.ts`) now also picks
  `utm_medium`, `gclid`, `source`, `first_source`, `campaign`, `first_campaign`.
  (Already exported on the `Lead` type.)

### 4.6 What this fix INTENTIONALLY does not do

- Does NOT re-write `derivedChannelFor` — aggregate source-card counts stay
  byte-identical to the pre-widening numbers (G1 unchanged; 36 Meta / 34
  Organic / 24 Direct / 20 Referral / 4 Google Ads / 1 Other, sum 119 out of
  the 1,310-lead non-legacy universe; the remaining 1,191 stay Unknown in
  aggregates).
- Does NOT read from `attribution.legacy_touches[]` — the collision-lead
  contract (G2) is preserved.
- Does NOT backfill any DB rows. No writes to `public.leads` or
  `public.payments`.
- Does NOT touch `legacy_status_backfill_snapshot`, the saarthi work, or the
  CRM fixture-fallback protection.
- Does NOT re-remove `pruneEmptyChannels` — the payload-size protection is
  still in place. The map only widens by ~1,200 entries (bounded by
  `getLeadsForPillMap`'s existing ceiling of ~1,310 non-legacy + a few
  legacy-with-channel), keeping the response well under the 4.5 MB serverless
  body limit.

---

## 5. Regression tests

New file `tests/payment-source-restore/payment-pill-display-widen.test.ts`
covers five widening contracts:

- W1 `deriveDisplayChannel` resolves the correct display channel per signal
  priority (scalar wins → `first_touch` fallback → utm fallback → form-source
  fallback → null for signal-less).
- W2 `derivedChannelFor` still reads the scalar `channel` ONLY — pins that a
  widened entry with `channel=null` and `displayChannel="Organic"` STILL
  buckets to `Unknown` in aggregate. Extended to a 5-phone mixed corpus.
- W3 `pruneEmptyChannels` keeps entries with EITHER signal non-empty (widened
  entries survive; signal-less entries are still dropped).
- W4 Collision-lead contract preserved — a collision row whose only
  attribution signal is `attribution.legacy_touches[]` (never `first_touch`,
  never scalar `channel`) returns `null` displayChannel; NEVER surfaces the
  legacy-touch source as if it were the real first-touch. Non-legacy still
  wins collisions.
- W5 Signal-less leads never fabricate a source.

Existing tests updated to include the new `displayChannel` field:
`tests/payment-source-restore/payment-source-restore.test.ts` and
`tests/payment-source-restore/payment-pill-scale.test.ts`. The scale-test
`mkLead` now defaults `source` to `""` so `pruneEmptyChannels` still drops the
synthetic null-signal stubs at 210/10 010 (unchanged pre-widening cap).

### 5.1 `tsc`

```
$ npx tsc --noEmit
[exit 0, no output]
```

### 5.2 `npm test` (full suite)

```
ℹ tests 368
ℹ suites 125
ℹ pass 368
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2374.5
```

### 5.3 `npm run build`

```
… (full route table printed)
ƒ Middleware                                                33.3 kB
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
[exit 0]
```

All three gates green. Nothing shipped red.

---

## 6. PR + merge + Vercel deploy

- Branch: `fix/payment-source-pill-display-widen` off `origin/master` @ `9fa382c4`.
- PR: https://github.com/namanias-dev/paid-subscriber-portal/pull/5
- Merge SHA: **`4c228540ca1eeff484e5cb151693606bdfdaa28a`**
  (`git log origin/master --oneline -1` → `4c228540 fix(payments): widen SourcePill to render on source-only leads (#5)`).
- Ancestry proof:
  ```bash
  $ git merge-base --is-ancestor 4c228540 origin/master && echo YES
  YES
  ```
- Vercel deployment id: `dpl_GKqiSU7WJiB7w3TgcfjAxvHeaUEK`, `state: READY`,
  region `bom1`, aliases include `www.namanias.com`, `namanias.com`,
  `namanias.vercel.app`. Ready at `1784928078949` (~2 min build).
- Prod version probe:
  ```bash
  $ curl -s https://www.namanias.com/api/version
  {"version":"4c228540ca1e"}
  ```
  Exact 12-char prefix of the merge SHA. Real user traffic is served by the fix.

---

## 7. Post-deploy prod smoke

Same queries as §3.2, run against prod immediately after the deploy went READY
(2026-07-24, prod SHA `4c228540ca1e`):

**Pill coverage — non-legacy lead attribution resolvable per distinct paid phone:**

| Metric                                       | Pre-fix (9fa382c4) | Post-fix (4c228540) |
|----------------------------------------------|-------------------:|--------------------:|
| distinct_paid_phones                         |                646 |                 646 |
| paid_phones_with_any_nonlegacy_lead          |                443 |                 443 |
| paid_phones_pre_fix_scalar_channel           |                 70 |                  70 |
| paid_phones_post_fix_any_signal              |                443 |                 443 |
| pill coverage rendered                       |     70/646 (10.8 %) |     443/646 (68.6 %) |

The DB numbers don't change (no writes) — what changed is which of them the
deployed code SURFACES on the payments page. Pre-fix code only surfaced the
`paid_phones_pre_fix_scalar_channel = 70` slice; post-fix code surfaces the
full `paid_phones_post_fix_any_signal = 443` slice.

**Aggregate G1 pin — scalar-channel distribution across non-legacy leads
(drives source-card totals via `derivedChannelFor`, must be byte-identical):**

| bucket        | pre-fix n | post-fix n |
|---------------|----------:|-----------:|
| (null)        |     1,191 |      1,191 |
| Meta Ads      |        36 |         36 |
| Organic       |        34 |         34 |
| Direct        |        24 |         24 |
| Referral      |        20 |         20 |
| Google Ads    |         4 |          4 |
| Other         |         1 |          1 |
| **TOTAL**     | **1,310** |  **1,310** |

Byte-identical. G1 preserved.

**Live sanity spot-checks (masked, aggregate-only) via the deployed API path
(the pill-map lookup mirrored in SQL):**

- Non-legacy leads with a scalar `channel`: 119 → pill renders as their
  captured channel string (Meta/Organic/Direct/Referral/Google/Other),
  unchanged.
- Non-legacy leads with `channel = NULL` but `source = 'quiz_public'` (528
  rows): pill now renders "Other" — honest bucket for form-only leads.
- Non-legacy leads with `channel = NULL` but `source = 'webinar'` (518 rows):
  pill now renders "Other".
- Non-legacy leads with `source = 'instagram'` (1 row): pill renders "Organic"
  (`deriveChannel` classifies `instagram` as Organic).
- Non-legacy leads with `source = 'referral'` (1 row): pill renders "Referral".
- Signal-less leads: no pill (unchanged — never fabricated).

---

## 8. Rollback

If a later smoke shows any anomaly (unexpected aggregate drift, elevated 5xx
on `/api/admin/payments`, or a pill regression), revert with:

```bash
gh pr revert 5 --admin --squash
```

The last-known-good prod SHA to fall back to is **`9fa382c437f6`** (this
document's ancestor). To promote it in Vercel directly (deployment is marked
`isRollbackCandidate: true`):

```bash
vercel rollback dpl_83YbdMkT1uwEieFLCmaVbKazcx5c \
  --scope naman-ias-academy --token <VERCEL_TOKEN>
```

---

## 9. PII masking note

All numbers in this report are aggregates. No lead id, phone, email, name,
address, payment id, or reference number appears. Test doubles use fake
phones `50000000xx` / `51000000xx`. Supabase MCP results were reduced to
COUNT/COUNT-FILTER aggregations before being pasted here.
