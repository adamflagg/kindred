# Family Camp Grain Collapse — the work-list

Every site where the family-camp sync folds per-person answers into one household value,
what rule each uses, how much it discards, and how the open issues map onto it.

Companion to `docs/reference/family-camp-field-provenance.md`, which covers what the
fields *mean*. This file covers what the code *does to them*. Read that one first —
several decisions here only make sense once you know a value's grain and its form.

Measured against the production snapshot at `pocketbase/pb_data/data.db`, tree `ffd5ee87`.
2026 was mid-registration when measured, so 2026 counts are floors.

---

## 1. Read these three traps before measuring anything

**1. It is not random, and three issue bodies say it is.** `#2255` (and text echoed into
siblings) warns that the collapse is "random-wins" and implies a flaky test. It is not.
Every map range on this path (`family_camp_derived.go:684`, `:838`, `:994`,
`lodging_requests.go:377`) affects only *output slice order*, never which value wins. The
winner is fixed by the input slice, and `loadPersonCustomValues` sorts by `id` (`:523`,
with a comment saying why). So the sites are **deterministic against a given database** —
arbitrary, uncorrelated with recency or completeness, unstable across a delete/recreate of
a source row, but *not* a per-run coin flip. A flakiness test will chase a ghost. The
correct probe is an **order-independence** test: permute the input slice, assert identical
output.

The one genuinely unordered site is elsewhere: `household_demographics.go` passes `""` for
sort (`:369`), which is `#2260`'s summer-path defect and a different file.

**2. Eight derived columns are zero for every year except 2026.** `share_eligibility` is
empty on all 3,459 rows for 2017-2025 and populated on all 464 for 2026 — only 2026 has
been through a current `family_camp_derived` run. Same for `needs_power`,
`needs_private_bathroom`, `share_cabin_gate`, `request_text`, `wants_*`,
`accommodation_is_mandatory`, `opt_out_vip`. **2025 currently reads as a year with no
accommodation needs at all.** Any baseline drawn from it is wrong, and a re-derive is a
prerequisite for measuring anything historical.

**3. State your denominator.** This is the error the verification pass kept finding. Three
populations give three different answers and none is wrong:

| Population | 2024 | 2025 | 2026 |
|---|---|---|---|
| All households with any family-camp value | 612 | 566 | 428 |
| Households with any FC adult signal | 469 | 418 | 382 |
| **Rostered** — actively enrolled (`status_id = 2`) in a `family` or `adult` session | **696** | **619** | **516** |

The rostered cut is the operational one. Use it, and say so.

---

## 2. The catalogue — 26 sites

Rule key: **first-wins** = first non-empty in id order, later values fall through
silently · **OR** = boolean or, fail-safe · **join** = dedup-and-join, lossless.
No site anywhere counts its loss: no `Stats` field, no `slog.Warn`, no
`lodging_ingest_issues` row, no conflict column, for any of the 20 lossy sites.

### `processAdults` — `family_camp_derived.go:636-676`

Group key `(household, adult_slot)`. All arms are `Contains(fieldName, X) && field == ""`.

| # | Column | Source cm_id | Rule | Notes |
|---|---|---|---|---|
| A1 | `first_name` | 34160 / 34161 | first-wins | documented at `:603-635`; holds a full typed name |
| A2 | `last_name` | 216785 / 216786 | first-wins | dead — 0 conflicts, unfilled after 2022 |
| A3 | `email` | 224590 / 224591 | `preferEmail` `:716-726` then first-wins | only site with a validity tie-break |
| A4 | `pronouns` | 241038 / 241039 | first-wins | |
| A5 | `gender` | 34163 / 34164 | first-wins | |
| A6 | `date_of_birth` | 34166 / 34167 | first-wins | **largest single loss in the file** |
| A7 | `relationship_to_camper` | 36523 / 36524 | first-wins | **semantically void** once separated from the child it is relative to |
| A8 | `name` | 219270-219272, 221653/221654 | none | household grain; `UNIQUE(year,household,field)` means no collapse occurs |

### `processRegistrations` — `family_camp_derived.go:749-836`

Exact-name switch, `if reg.X == ""` guards.

| # | Column | cm_id | Line | Rule |
|---|---|---|---|---|
| R1 | `share_cabin_preference` | 240877 | `:760-763` | first-wins — **resolved by a different rule than `share_cabin_gate` on the same row** |
| R2 | `shared_cabin_modes_raw` | 263379 | `:764-767` | first-wins (no readers) |
| R3 | `arrival_eta` | 36529 | `:768-771` | first-wins |
| R4 | `special_occasions` | 60413 | `:772-775` | first-wins |
| R5 | `goals` | 36526 | `:781-784` | first-wins (retired after 2024) |
| R6 | `notes` | 36528 | `:785-788` | first-wins |
| R7 | `cabin_assignment` | 218072 | `:734-745` | household grain, no collapse |
| B1 | `needs_private_bathroom` | 274056 / 274053 | `:815-816` | **OR — correct** |
| B2 | `has_infant` | 257248 | `:823-830` | **OR — correct** |
| B3 | `needs_accommodation` | 223999 / 274057 / 274055 | `:794-795` | **OR — correct** |
| B4 | `opt_out_vip` + `accommodation_is_mandatory` | 256927 / 256935 | `:796-814` + `:838-853` | **OR plus an order-independent blocker override.** The best-designed site on this path and the model for what a conflict rule should look like |
| B5 | `needs_power` + bathroom arm | 256582 / 171577 / 256933 | `:817-822` | OR of two independently-tested needs via `classifyCPAPAnswer` — correct |

### `CollapseToHouseholdGrain` — `lodging_requests.go:291-390`

The only site with a written-down, reviewed policy.

| # | Column | Line | Rule |
|---|---|---|---|
| C1 | `share_cabin_gate` | `:344-357`, `winsGate` `:408-418` | **newest-wins by `last_updated`**, form field breaks an exact tie. `sawDeclineGate` `:347-349` preserves one direction of the discarded signal |
| C2 | `request_text` | `:366-372` | **dedup-and-join — LOSSLESS.** The model to copy |
| C3 | `wants_near/with/similar_ages` | `:358-364` | OR — correct |
| C4 | `share_eligibility`, `share_answers_conflict` | `:377-386` | derived from the collapsed set; the conflict flag is computed against the **winner only**, which is `#2269` |

### `processMedical` — `family_camp_derived.go:981-992`, then `:994-1095`

| # | Column | Line | Rule |
|---|---|---|---|
| M0 | *the flatten itself* | `:986-988` | first-wins across **every** field name, before any per-field logic. **This one site is behind M1-M8** |
| M1 | `cpap_info` | `:1010-1021` | first-wins, **plus a `break` at `:1015`** keeping the older camper generation (171577) over the newer (256582). Adult-CPAP (256933) is correctly additive |
| M2-M5 | `physician_info`, `special_needs_info`, `allergy_info`, `dietary_info` | `:1024-1065` | each concatenates a **gate token with a narrative**, chosen independently by M0 — so the two halves can come from different people |
| M6-M8 | `additional_info`, `bathroom_explain`, `accommodation_explain` | `:1068-1084` | first-wins |

---

## 3. How much is discarded

Method: group by `(year, household, cm_id)`. A group with ≥2 non-empty person rows is
**sparsity** if all values are equal, **conflict** if ≥2 distinct. Only conflict is loss.
Sparsity outruns conflict roughly **5:1** — most of the flatten is legitimately collapsing
one parent's answer copied onto several children's forms.

| Cut | 2024 | 2025 | 2026 |
|---|---|---|---|
| Answers discarded, all households | 828 | 843 | 637 |
| Answers discarded, **rostered** | **689** | **676** | **569** |
| Rostered households losing ≥1 answer | 252 / 696 (36%) | 207 / 619 (33%) | 196 / 516 (38%) |

Top sites by 2026 loss, rostered cut: DOB 92 · dietary narrative 75 · allergy narrative 67
· email 60 · first name 57 · additional medical 44 · arrival ETA 38 · bathroom explain 22
· gender 20 · relationship 17.

Two sites are lossless and confirmed by measurement: **C2** (57-87 second answers *survive*
per year that the other sites would discard) and the five OR sites **B1-B5** (0-6 conflicts
a year, ORing to the fail-safe direction rather than discarding).

### Reproducing it

```sql
CREATE TEMP VIEW pv AS
SELECT pcv.year yr, p.household hh, d.cm_id cmid, TRIM(pcv.value) val
FROM person_custom_values pcv
JOIN persons p ON p.id = pcv.person AND p.year = pcv.year
JOIN custom_field_defs d ON d.id = pcv.field_definition
WHERE pcv.year IN (2024,2025,2026) AND p.household <> '' AND TRIM(pcv.value) <> '';

-- answers discarded per year (exclude the lossless C2 cm_ids)
SELECT yr, SUM(CASE WHEN nd >= 2 THEN nd - 1 ELSE 0 END)
FROM (SELECT yr, hh, cmid, COUNT(*) nrows, COUNT(DISTINCT val) nd
      FROM pv GROUP BY 1,2,3)
WHERE cmid NOT IN (274133, 240598, 206286)
GROUP BY yr;
```

For the rostered cut, inner-join:

```sql
JOIN (SELECT DISTINCT p.year, p.household
      FROM attendees a
      JOIN persons p ON p.id = a.person
      JOIN camp_sessions s ON s.id = a.session
      WHERE s.session_type IN ('family','adult') AND a.status_id = 2) r
  ON r.year = pv.yr AND r.household = pv.hh
```

### Confirmed on the staff artifact

The housing-request CSV has 98 child rows across 63 households; 31 have ≥2 children.
**23 of those 31 (74%) carry at least one column where sibling rows hold different
non-empty values** — 45 discarded answers on one weekend's report. Worst: `Share Bunk With`
10 households (but see the provenance doc — that column is summer-scoped and not a lodging
input), `FamilyMedical-Additional` 9, `Housing-Bathroom` 7, then `Shared-request`,
`COVID-19BunkingRequests` and `FamilyCamp-SpecialNeedsYes` at 3 each.

Columns 25-29 (`FamilyCampAdult1-5`) show **zero** conflicts and pure repetition across
sibling rows — confirming they are household-partition values fanned onto child rows.

---

## 4. Issue map

**None of the seven is a duplicate.** `#2255`, `#2274` and `#2275` are three siblings of
one mechanism in one file, sharing one root loop shape, one prerequisite and one ~100-line
region — they should ship as **one PR**, but merging the *issues* would lose three
genuinely different collapse policies (narrative join vs free-text join vs per-attribute
decision).

| Issue | Sites | Status against the tree |
|---|---|---|
| `#2257` | tracking | Says "20 sites, three mechanisms". The catalogue finds **26 sites**; 20 lossy is right |
| `#2255` | M0 + the M1 `break` | Anchors correct. Reproduced: 330 rows reading `"No; <narrative>"` (243 with 2+ answerers); 703 household-years hold both camper CPAP generations, **70 disagreeing** |
| `#2274` | R1-R6 | **Every cell reproduced exactly:** Trans ETA 420/428/121 · Goals 240/247/0 · Anything else 73/75/29 · Share Cabins 30/30/24 · Shared Cabin 16/16/16 · Special occasions 14/14/5. One anchor wrong: "the person loop at `:757`" — it opens at **`:749`** |
| `#2275` | A1-A7 | **Reproduced exactly:** DOB 1,124 colliding / **1,151 lost** · first name 791/801 · gender 511/513 · relationship 315/323 · email 326 colliding. Its latent-collision warning is real and confirmed: `FAM CAMP Adult 1/2 Gender-Other` (240871/240872) and `FAM Camp Adult 1/2-Pronouns other` (241040/241042) would funnel into the `gender`/`pronouns` arms and carry zero values in every year |
| `#2269` | C4 | Not a data-loss site — C1's collapse is correct; the review flag is what is missing. Correctly scoped |
| `#2270` | ingest upsert, not a transform | Latent — 0 duplicate key groups today. The household twin at `household_custom_field_values.go:319-320`/`:329` has the identical shape |
| `#2260` | `household_demographics.go:494` | **Summer path, distinct file and loader.** Also the only genuinely unordered site |

### Bodies to correct before implementing

Repo convention is to fix the body in place with `gh issue edit`, and comment saying what
changed. See `CLAUDE.md` §4.

- **`#2255`** and the siblings echoing it — the "random-wins / flaky" framing. Replace with
  deterministic-but-arbitrary, and swap the proposed flakiness test for an
  order-independence probe.
- **`#2274`** — anchor `:757` → `:749`; loss table omits the share fields.
- **`#2275`** — add that slots 3-5 carry *no* attributes in any year, so the entire
  attribute loss is a slots-1-and-2 phenomenon.
- **`#2276`** — claims three unrouted questions; the live population is **35** admitted-
  but-unrouted family-camp definitions, ~5,000 values in 2026 alone.
- **`#2256`** — three factual errors and an unmentioned blocker; see the provenance doc's
  bunking section. Someone implementing from it today ships something that looks correct
  on 10 children and silently omits 27.

---

## 5. Recommended order

**Step 0 is a hard prerequisite and nothing can start without it:** widen
`customValueEntry` (`family_camp_derived.go:437-445`) to carry the person PB id and cm id.
It currently discards the person id at load, which is the root architectural cause of
every site above. Both `#2255` and `#2275` name it.

1. **Step 0** — widen `customValueEntry`.
2. **Build the per-answer tables, dual-write** alongside the existing ones. No consumer
   changes. This is where the loss is provably recovered and where the order-independence
   probe belongs.
3. **Re-derive the three existing tables** from the new person tables rather than from
   `personValues`, adding dedup-and-join plus a single `answer_conflicts` JSON array naming
   which fields disagreed — one column, not four booleans, so adding a field later needs no
   migration. `#2255`, `#2274`, `#2275` all close here.
4. **Add `session_cm_id`** to `family_camp_registrations`. **The grain triple must move in
   one PR:** the write key in `upsertRegistrations`, the orphan key `ProcessedRegKeys`
   (`family_camp_derived.go:34`), and `idx_fc_reg_unique` (migration `1500000035:288`).
   Then switch `fetch_family_camp_registrations(year)` → `(year, session_cm_id)`.
5. **Point the weekend medical panel** at the per-answer table and wire
   `original_bunk_requests` into the roster — the two things staff asked for directly.

**No backfill, no data migration, no CampMinder re-fetch.** `person_custom_values` holds
1,608,513 rows under `UNIQUE(year, person, field_definition)` with **zero** duplicate key
groups; `household_custom_values` likewise. The three `family_camp_*` tables are
sync-owned, have no `staff_touched` column and no GUI write path. Every value is recovered
by re-running `family_camp_derived` against data already on disk.

---

## 6. Carry-forward warnings

- **Person grain preserves *who answered*, not *who the answer is about*.** 31.5% of
  allergy narratives name a household member other than the record holder. Any UI built on
  the per-answer table must say **"reported by"**, never "about". This is the single
  easiest way to turn a data fix into a clinical error.
- **`family_camp_medical` has no enrolment filter** — 381 of 886 2026 rows are out of
  family-camp scope, because `processMedical` reads `Family Medical-*` fields that summer
  campers also answer. Narrowing it is a behaviour change; confirm with staff before
  assuming it is a bug.
- **`relationship_to_camper` is void at household-adult grain** and only becomes
  well-defined keyed by the reporting person. Whether the household rollup should carry any
  version of it is open.
- **`date_of_birth` / `gender` / `pronouns` on adults** — kindred#1945's parked decision
  (whether these columns are kept at all) now gates the single largest loss site (A6, 92
  answers in 2026). Worth resolving before step 2, not after.
- **Which years to replay** is a real decision, not a detail. Only 2026 has been through a
  current run. A re-grain that also backfills 2024-2025 changes thousands of historical
  rows written by three code generations. The only known reader of those years is the
  year-over-year card, which reads `cabin_assignment` only.

---

## 7. Relationship to the wider transform-grain audit

A broader audit ran first and produced this issue family. It covers **the whole sync
layer** — 118 grain-reduction sites, 19 losing — and classifies loss into three
mechanisms: **A** person→household first-wins, **B** coarse target grain on a relation key,
**C** mapping gaps (the largest class, ~23,254 values). Its framing is still the right one
and this file does not replace it: this file is the family-camp **depth** pass under its
mechanism A.

Three things in it to correct before relying on it:

1. **"Random / SQLite paging order" over-generalises.** It is accurate for
   `household_demographics.go:494`, which passes `""` for sort. It is **wrong** for
   `family_camp_derived.go`, which sorts by `id` at `:523`. Deterministic-but-arbitrary,
   as §1 above sets out. Its *remedy* — the order-independence probe — is right either way.
2. **It counts `family_camp_derived.go:988` as one site.** That is site M0 here, and M0
   alone is behind M1-M8. The family-camp path holds **26** sites, 20 of them lossy. Its
   per-site figure and this file's path-wide figure are different measurements, not
   competing ones.
3. **Several of its items have shipped.** Closed since it was written: the licence-plate
   spelling (`#2258`), the summer household first-wins (`#2260`), `can_bring_others`
   (`#2262`), the person-custom-value orphan-sweep cap (`#2266`), and its **step 0** — a
   counted database failure now fails the run (`#2284`, PR `#2293`). Its remaining
   guardrail steps 1-5 are unshipped and still the recommended order.

What this file adds that the wider audit could not see, because it predates reading the
forms: the semantics in `family-camp-field-provenance.md`, and in particular that the
Information form is **re-submittable**. That splits mechanism A into two populations
needing opposite rules — genuine re-submission months apart, where recency is correct, and
same-sitting name variance, where normalisation is. A single `NewestWins` policy applied
across mechanism A would get the second population wrong.
