# Family Camp Field Provenance

What each family-camp housing field actually is: which form asks it, the question a
family reads, what shape the answer takes, and which internal column it becomes.

Companion to `docs/reference/sync-id-conventions.md` (ID conventions),
`docs/architecture/sync-layer.md` (job order) and `docs/reference/lodging-registry.md`.

**Why this file exists.** None of it is discoverable from the CampMinder API. See
[The API ceiling](#the-api-ceiling) — the API returns a field's internal admin label and
nothing else. Question text, answer options, conditional logic and form membership exist
only here and in the heads of the staff who built the forms. Treat this file as the
system of record for those, and correct it in place when it is wrong.

---

## 1. There are exactly two grains

CampMinder stores a custom value against either a **person** or a **household**. That is
the whole taxonomy, and it is the load-bearing fact, because grain decides whether
collapsing a value to a household is safe.

| Grain | `custom_field_defs.partition` | Stored in | One value per |
|-------|-------------------------------|-----------|---------------|
| **per-child** | `["Camper"]` | `person_custom_values` | person, per year |
| **adult** | `["Adult"]` | `person_custom_values` | person, per year |
| **household** | `["Family"]` | `household_custom_values` | household, per year |

Two things that look like additional grains and are not:

- **The vendor's adult list is a transform, not a source.** `Family Camp Adult 1-5`
  (household partition) is populated by CampMinder *vendor* staff who read the per-child
  `Family Camp-P1 First Name`, `P2 First Name` and `Family Camp-Additional Adults`
  answers and retype them as household values, splitting names by hand. It is child data
  promoted to household grain by a human. The per-child fields are the source of truth;
  the slots are a hand-made copy. See [§6](#6-the-adult-transcription-chain).
- **The bunking CSV upload is a transport, not a source.** `BunkingNotes Notes`,
  `Share Bunk With` and `Internal Bunk Notes` are per-child data living in CampMinder's
  Bunking module. They are not custom fields and have no API endpoint, so they reach
  Kindred only via a hand-uploaded CSV export. The upload is how they travel, not what
  they are.

---

## 2. The API ceiling

Verified against the vendored OpenAPI specs in `docs/api/external/campminder/specs/` and
against all 1,270 field definitions already synced into `custom_field_defs`.

### What the API gives you

`CustomFieldDefinition` has exactly **seven** properties:

```text
Id, Name, DataType, Partition, IsSeasonal, IsArray, IsActive
```

That is precisely what `custom_field_defs` already stores. There is nothing else to fetch.

### What it does not give you

- **No question text.** `Name` is the internal admin label (`FAM CAMP-Share Cabins`), not
  the sentence a parent reads.
- **No option list.** Nothing enumerates the choices of a select.
- **No validation.** No required flag, no max length, no conditional/skip logic.
- **No form membership.** Nothing says which form a field appears on, or in what order.

### `DataType` does not even give you the answer type

Across all 1,270 definitions: **1,259 are `String`**. Five `Boolean`, four `Integer`, two
`Decimal`. Every family-camp housing field is `String` — the yes/no gates, the
multi-option selects, the free text, and the adult *count* alike.

**`IsArray` is the only structural signal the API provides.** Exactly one field in the
housing set carries it: `FAM CAMP-Shared Cabin` (263379), which is why that one alone is
pipe-delimited.

> **Consequence.** Answer type, option vocabulary and conditional logic must be
> **inferred from stored values**. This is the root cause of kindred#1875 — nothing in the
> schema said the CPAP field was a multi-option select. When you need a field's real
> shape, run `SELECT DISTINCT value ...`, never trust `DataType`.

### The five bunking fields are not reachable at all

Confirmed four independent ways:

1. Absent from all 1,270 field definitions under any spelling of *bunk*, *socialize*,
   *note*, *internal* or *request*.
2. Not properties on `PersonResponse` (25 props) or `CamperDetails` (12).
3. No note/request/comment property on any schema in `bunks.yaml`.
4. No relevant operation among the **28 total operations** across the seven base URLs
   (auth, sessions, persons, bunks, divisions, staff, financials).

Near-miss, so nobody re-investigates: `Family Camp-Camper 1-7 Bunk With` / `Bunkmate`
(36533-36552, 14 definitions) *are* per-camper custom fields and *would* be API-reachable,
but hold **zero values in every year from 2023 on**. Dead legacy fields.

The CSV export is the only route. The fixable part is the **report definition** — it is
summer-scoped, which is why 73% of family-camp children with a staff bunking note are
invisible to Kindred — not the transport.

---

## 3. The Family Camp Information form

Question text as presented to families. Supplied by camp staff 2026-08-13; this is the
authoritative record, since the API exposes none of it.

The form opens with the shared-cabin question.

> **Scope of what is validated.** This form has been read in full. The Registration form
> is now **partly** recovered — its housing block only, from a confirmation PDF — see
> [§3b](#3b-the-camper-registration-form--housing-block).
>
> Still **inferred from stored values only**, because they are conditional fields that did
> not render on the single confirmation available: `Shared-request` (274133),
> `Housing-Bathroom` (274059), `Housing Accommodation-Yes` (274058) and
> `FAM CAMP-Opt Out VIP` (256927). Their absence is itself consistent with gating — that
> camper answered "No" to both the bathroom and accommodation gates.
>
> Confirmed present on Registration, from its prose block: `FAM CAMP-Share Cabins`,
> `FAM CAMP-CPAP`, `FAM CAMP-bathroom`, `Housing Accommodation`. **Not** the adult block —
> `Total Adults-FC` and the per-child P1/P2 fields are on *this* form, and the
> confirmation merely prints their values ([§3b](#3b-the-camper-registration-form--housing-block)).
>
> One caveat that has not changed: `custom_field_defs` has no form column, so form
> membership is only ever established by reading a form, never from the database.

| # | Field label | Question as families read it | Answer shape |
|---|-------------|------------------------------|--------------|
| 1 | `FAM CAMP-Shared Cabin` | Would you like to share a cabin with another family or be housed near another family? | **Multi-checkbox**, four options (see [§5](#5-inferred-option-vocabularies)). The only `IsArray=1` field in the set; stored pipe-delimited |
| 2 | `COVID-19 Bunking Requests` | Housing request | Free text. **Not conditional** — see the note below |
| 3 | `Family Camp-Special Needs` | Does anyone in your family have a developmental, physical, emotional, or social need that requires an accommodation? Please let us know so we can best support your family at Camp! | Select one, Yes / No |
| 4 | `Family Camp-Special Needs Yes` | If yes, please explain: | Free text, gated on #3 = Yes |
| 5 | `Family Camp-Anything else` | Anything else you'd like us to know about your children or family? | Free text |
| 6 | `Family Medical-Additional` | Please list any additional health information on any member of your family (including current medications). List the family member and medication/condition. | Free text |
| 7 | `Family Camp-CPAP` | Is anyone in your family bringing a CPAP machine to Camp? | Yes / No |
| 8 | `Family Medical-CPAP Explain` | If yes, please explain: | Free text, gated on #7 = Yes |

### `COVID-19 Bunking Requests` is not conditional, and the name is misleading

Two corrections that have both bitten already:

- **It is not about COVID.** It is the live housing-request free text. The name is legacy
  residue and causes readers to skip it. The `cm_id` (206286) is the contract.
- **It does not depend on the shared-cabin answer.** An internal working sheet annotated
  it "If FAM CAMP-Shared Cabin is anything". That is wrong, and this one is **fully
  settled** — both fields sit on the Family Camp Information form, the form that has been
  read, and staff confirm no gating. The data agrees: people who answered the
  housing-request box while leaving the shared-cabin question blank number **39 of 412
  (9.5%) in 2025** and **38 of 249 (15.3%) in 2026**. Under a real gate that is
  impossible. (2024 reads 356 of 356 because 263379 carries no values that year — ignore
  it.)

  **The transform correctly ignores the claimed dependency, and that is what preserves
  those households' requests.** Anyone who "fixes" the code to honour that note will
  delete real requests.

---

> ## ⚠️ SUPERSEDED IN PART, 2026-08-13 — the Registration form has now been read
>
> Camp staff read the live Camper Registration form on 2026-08-13. Four things in §3 and §3b
> above are now settled or corrected, and one mechanism is new:
>
> **1. A field can live on BOTH forms.** A CampMinder custom form can point at a backend field
> and allow *update*, so the same stored field is offered on the Registration form and again on
> the Family Camp Information form. This resolves the P1/P2 puzzle — the adult block appears on
> both while writing **one** stored field — and it means §3b's *"**Not** the adult block"* is
> **wrong**. It is on the Registration form, and also on the Information form.
>
> **2. This gives §3c a second drift mechanism it does not have.** §3c attributes sibling
> divergence to the Information form being re-submittable. With the same fields exposed on two
> forms, drift also arises from *two different forms writing one field at different times* —
> which fits the bimodal timestamps at least as well and requires nobody to have filled one form
> twice. Treat §3c's mechanism as **one of two**, not the explanation.
>
> **3. The four fields §3 lists as "inferred from stored values only" are now confirmed**, with
> question text and gating:
> - `FAM CAMP-bathroom` (274056) — *"Does your family require access to a bathroom that doesn't
>   require you to leave your cabin for a medical or accessibility-related reason?"*, boolean
> - `Housing-Bathroom` (274059) — *"If yes, please explain the medical condition or accessibility
>   need:"*, conditional free text
> - `Housing Accommodation` (274057) — *"Does your family need another housing accommodation for
>   a medical or accessibility-related reason?"*, boolean
> - `Housing Accommodation-Yes` (274058) — *"Please explain the medical condition or
>   accessibility need:"*, conditional free text
> - `FAM CAMP-Opt Out VIP` (256927) — *"If there is a waitlist for cabins with bathrooms and/or
>   electricity, and a cabin is available that does not meet your needs … do you still want to
>   register for this program?"* → *"Yes, please register regardless of cabin type"* /
>   *"No, I am only able to attend with this accommodation in place"*. **Gated on the
>   ACCOMMODATION boolean (274057)**, not the bathroom one.
>
>   **This answer is ONE stored boolean — `accommodation_is_mandatory`, its No pole**
>   (owner ruling 2026-08-22): answered *No* → true (a blocker — "must have the
>   accommodation or they cancel"); answered *Yes* or unanswered → false (soft). A blocker
>   anywhere in the household wins structurally, since only the No pole is OR'd.
>   *History, so nobody re-derives it:* the original derived-tables work (#91) also stored
>   the Yes pole as `opt_out_vip`; #1878 added the explicit blocker column after
>   kindred#1874 showed that reading the Yes pole's OR as a blocker inverts a sibling's
>   "cannot attend" into "will cope" (~3 households/year), and the vestigial Yes-pole
>   column was retired by the same PR that first tried to surface it (#2535).
>
> **4. The share gate's three options, verbatim** — `FAM CAMP-Share Cabins` (240877) is a
> pick-one radio, not the four-checkbox `FAM CAMP-Shared Cabin` (263379):
> - *"Yes, I would like to share a large camper cabin with a family that I request or with a
>   family with similarly aged kid(s) that I can meet at Camp."*
> - *"Maybe, I am open to sharing a large camper cabin if a specific family that I know wants to
>   share a cabin with my family."*
> - *"No, we would prefer not to share a camper cabin."*
>
> The "Maybe" wording is narrower than the word suggests — it means *only with a family I already
> know*. `NormalizeShareGate` already encodes this correctly (`lodging_requests.go:214`,
> `gateMaybeMutual` → `share_eligibility = "named"`).
>
> **5. Not a form, but recorded here because nothing else says it:** the *"family/adult
> registration form"* is a misnomer — it is used only for individuals attending Women's and
> Men's weekend.

## 3b. The Camper Registration form — housing block

Recovered 2026-08-13 from a single camper's registration **confirmation PDF** (one real
record, gitignored, never committed).

> **What this document can and cannot prove — read before citing it.** Its custom-field
> section is headed `CUSTOM FIELDS` and dumps **the camper's values across every form**.
> It therefore proves *a field holds a value for this camper*; it does **not** prove
> *which form asked it*. Field adjacency in the dump is layout, not provenance — the
> adult block prints beside the housing questions while living on a different form
> entirely ([§3c](#3c-the-information-form-is-updatable--the-drift-engine)).
>
> What the PDF *does* establish is the **prose**: the housing description and the Shared
> Cabin Incentive text are printed with the housing questions, and their content is
> registration-time by construction — the discount is "off your Family Camp
> registration", and the text forward-references a *later* form for naming families. That
> prose is identical for every family and contains no personal data.

### The housing block

```text
<housing description — see below>
  FAM CAMP-CPAP (256582) · FAM CAMP-bathroom (274056) · Housing Accommodation (274057)

"Shared Cabin Incentive: ..."
  FAM CAMP-Share Cabins (240877)
```

The registration form **defers naming to the later form**: *"You will have an opportunity
to request specific families closer to the time of the program, or can note your
request(s) below in the comments."* That is the two-form sequence stated to families, and
it is why the naming fields live on the Information form.

One field-label note, unrelated to provenance: `Total Adults-FC` (209430) renders as
**"Total # of Adults"**. Earlier searches missed it because the stored definition name
differs from the label families read.

### The housing description, verbatim

> Our Family Camp cabin spaces include individual rooms in shared spaces, large camper
> cabins, small cabins and yurts, and housing is spread all over the grounds. The majority
> of our cabins have twin-sized beds, no overhead lighting and are a short walk to a
> shared bathhouse. Smaller families with 2-3 participants will be assigned to smaller
> living spaces, or they can opt into sharing a large camper cabin with another family.
> **We have minimal housing with attached bathrooms — these spaces are set aside for
> families with children under 2 years of age, seniors who need this accommodation, and
> families in need of specific accommodations for medical or accessibility-related
> reasons.** Camper Cabins (one large room) are a primary housing option we prioritize for
> families with four or more people, including children ages 2 - 16.

**This is the rationing rule for the scarcest housing, written down**, and it is useful
for what it says about *contention* rather than as a taxonomy to model. Seniors are not a
separate signal to capture — a senior who needs the accommodation answers the
accommodation question like anyone else, and this is one prose sentence, not a field list.
Defining camp's questions is camp's job, not the schema's.

What the passage does establish is **who competes for the same scarce units**: infant
families, and anyone answering the bathroom or accommodation gates. That contention is
real and nothing models it today.

Two allocation rules stated here are worth holding onto because they are ours to
implement: **party size drives unit type** (four or more → Camper Cabin), and the under-2
boundary in the prose is the same one `INFANT_BED_EXEMPT_MONTHS` encodes.

### The share gate is financially incentivised

> **Shared Cabin Incentive:** Due to historically increased demand for Family Camps, we are
> offering a **20% discount** off your Family Camp registration to families who share large
> camper cabins (one large room with bunk beds — no walls separating the space — and a
> short walk to a shared bathhouse) at a Family Camp weekend. If you want to share a cabin
> with another family, please check the box below. If you end up sharing a cabin, you will
> receive the discount following the weekend. [...] Please note, we can not guarantee
> specific requests but we will do our best.

**A "yes" on `FAM CAMP-Share Cabins` is partly a price decision, not purely a social
preference**, and the discount is contingent on actually being shared. Nothing downstream
knows this. It is the most likely explanation for the large "Maybe" population, and it
means a share request is weaker evidence of social intent than its wording suggests —
while *declining* is correspondingly stronger, since the family is turning down money.

---

## 3c. The Information form is updatable — the drift engine

Per camp staff, 2026-08-13. This is the single most explanatory fact in this file, because
it accounts for several anomalies that otherwise look like separate defects.

**The chain.** `Family Camp-P1 First Name` (34160), `Family Camp-P2 First Name` (34161),
`Family Camp-Additional Adults` (36525) and the total-adults field live on the **Family
Camp Information form**, and CampMinder vendor staff transpose *from there* into
`Family Camp Adult 1-5`.

**Two properties of that form break the chain:**

1. **It can be updated after submission.** The vendor's transposition is therefore a
   **point-in-time snapshot of a moving source**. A family that adds a grandparent, drops
   an adult, or corrects a name after the transposition leaves the household slots stale,
   and nothing re-reconciles them — 36525 has no reader in the codebase at all.
2. **It says "You will only need to fill out this form once per family" — and it is a
   family-level form landing on child records.** When a family fills it once, one child
   carries the answers and the siblings are blank. **When a family fills it more than
   once, two children carry *different* answers.**

**What this explains, all at once:**

| Symptom | Explanation |
|---|---|
| Stated vs listed adult counts disagree (18 of 380 households in 2026) | The count was stated at one moment; the slots were transposed at another |
| ~45% of households naming additional adults have no slot 3-5 | Updates landing after transposition, plus 36525 having no reader |
| Siblings disagree on family-level answers | The form was filled more than once, on different children |
| Siblings are merely *sparse* rather than conflicting | The form was filled once — the intended behaviour |
| `Total Adults-FC` sibling disagreement (52.2% in 2024, ~1% after) | See the 2024 caveat in [§7](#7-standing-traps) |

**Consequences for design.** Three, and they are not obvious from the data alone:

- **Sparsity and conflict are different events, not different amounts of the same event.**
  Sparsity means *filled once, correctly*; conflict means *filled twice*. Any transform
  that treats them on one scale is modelling the wrong thing. Coalescing across siblings
  is right for sparsity and wrong for conflict.
- **Recency is a defensible tie-break here, and only here.** Because the source is a
  form that is legitimately re-submitted, `last_updated` carries real meaning for these
  fields — unlike the first-non-empty-by-record-id rule, which correlates with nothing.
  Any per-answer layer must retain `last_updated` per answer for this reason.
- **The vendor slots are a cache, not a source.** Treat `Family Camp Adult 1-5` as a
  derived snapshot that can go stale, and the per-child Information-form fields as the
  source of truth. That is the opposite of how kindred#1943's body frames it.

### Measured: the timestamps confirm it, and separate two distinct mechanisms

Every child's copy is written separately — **zero** households share a `last_updated`
across siblings, in any field or year. The *spread* between those writes is bimodal, and
that is what distinguishes a single sitting from a genuine re-submission (2026):

| Field | Siblings agree | Siblings differ |
|---|---|---|
| **Total Adults-FC** | n=192, median **0.00d**, 174 within a day | n=9, median **133 days**, **none** within a day |
| Additional Adults | n=8, all within a day | n=12, median 2.05d, max 264d |
| P1 First Name | n=199, median 0.01d, 120 within a day | n=28, median 0.01d, **19 within a day** |

Read the top row first: when a household's adult counts agree, the writes are minutes or
hours apart — one sitting, fanned across the children. When they **disagree**, they are a
median of **four months** apart and *not one pair* was written on the same day. That is
the drift, visible in the data exactly as staff describe it.

**Two mechanisms, needing opposite fixes:**

- **Re-submission** (`Total Adults-FC`, most of `Additional Adults`): months apart, a real
  update. **The later answer is the right one** — recency is the correct rule.
- **Same-sitting variance** (`P1 First Name`: 19 of 28 divergences within a day): the
  family typed the same adult's name slightly differently on each child's page in one
  sitting. Recency is meaningless here; these want **normalisation and dedup**, because
  the two values denote one person.

Treating these as one problem — which every current transform does — guarantees getting
one of them wrong. Note the interaction with [§6](#6-the-adult-transcription-chain): the
name-variance class is precisely what makes the vendor's hand-dedup hard, and the
re-submission class is what makes their snapshot go stale.

---

## 4. The gate → explain pattern

A form-authoring convention the camp uses on the Family Camp Information form, and on
other camp forms such as the dietary and allergy questions. It is **not** a CampMinder
platform construct — CampMinder neither enforces nor exposes the link. Every field in
every such pair lands as an ordinary **per-child custom value**.

```text
<Gate>          Yes / No select
<Gate> Yes      free text, shown only when the gate is Yes
```

Known pairs — housing plus the medical forms that use the same convention:

| Gate | Explain |
|------|---------|
| `Family Camp-Special Needs` (182696) | `Family Camp-Special Needs Yes` (182698) |
| `Family Camp-CPAP` (171577) | `Family Medical-CPAP Explain` (171578) |
| `Housing Accommodation` (274057) | `Housing Accommodation-Yes` (274058) |
| `Housing Accomodation` (274055, Adult, sic) | `Accommodation-Explain` (224987) |
| `FAM CAMP-bathroom` (274056) | `Housing-Bathroom` (274059) |
| `Family Camp-Special occasions` (60413) | `Family Camp-describe special occasion` |
| `Adult-Bathroom` (274053) | `Bathroom-Yes` (274054) |
| `Family Medical-Allergies` (36870) | `Family Medical-Allergy Info` (36871) |
| `Family Medical-Dietary Needs` (36872) | `Family Medical-Dietary Explain` (36873) |
| `Family Camp-Physician ` (39680) | `Family Camp-Physician If Yes` (39681) |

> `Family Camp-Physician ` carries a **trailing space** in its own name — that is not a
> typo here or in the CampMinder admin UI. It is the field `normalizeFieldName` exists to
> work around; see [§7](#7-standing-traps).

### The splice: a gate and its explanation can survive from different children

`processRegistrations` and `processMedical` collapse each field to household grain
**independently**, taking the first non-empty value over an id-sorted list of person
values. Because the two halves of a pair are separate fields, their winners can be
different children.

Measured share of households (where both halves have a value) whose **id-min gate row and
id-min explain row belong to different children**:

| Pair | 2024 | 2025 | 2026 |
|------|------|------|------|
| Special Needs | 7 / 66 · 10.6% | 11 / 66 · 16.7% | 2 / 40 · 5.0% |
| CPAP | 9 / 36 · 25.0% | 13 / 39 · 33.3% | 2 / 20 · 10.0% |
| Housing Accommodation | — | — | 11 / 30 · 36.7% |
| Bathroom | — | — | 17 / 45 · 37.8% |

**Of the four rows above, this is worse than losing a sibling's text for Special Needs and
CPAP only.** Those two pairs concatenate a **stored gate string** with a stored explanation
in `processMedical`, so the two halves of one question get spliced across two children and
the explanation staff read does not necessarily describe the need that raised the flag.

**Housing Accommodation and Bathroom are not the same claim, and their rows should not be
read against the other two.** Both gates are stored as household-wide OR booleans by
`processRegistrations`, and `family_camp_medical` stores no gate string for either — there
is no second *stored* half to splice against, so their rows above measure winner provenance
only, exactly as the heading says: the id-min gate row and the id-min explain row belong to
different children.

**That is a different quantity from harm, and the second does not replace the first.**
Winner provenance is the 11 / 30 and 17 / 45 in the table. *Harm* — households whose stored
explanation came from a child who did not themselves answer the gate Yes — is **0 of 30**
and **0 of 45** for 2026, and is zero structurally, because the gate is an OR across the
whole household and no gate string is stored for it to disagree with. Re-running the first
measurement will keep giving 11 / 30; that is not a contradiction of the zero. Their
residual defect is narrative **loss** — an answering child's explanation can still be
dropped in favor of another answering child's — not splice; the loss is kindred#2255.

**The highest measured stored splice is CPAP 2025 at 33.3% (13 of 39), not the ~38% the
Bathroom row implies if all four rows are read as one measurement.** Housing Accommodation
and Bathroom have 2026-only rows because their derived columns have only ever been computed
for 2026.

**Design rule that follows:** a gate and its explain must stay bound to the same person
through any transform. In a per-answer layer that is automatic. In any household rollup it
has to be explicit — collapse the *pair*, never the two fields independently. This is a rule
about **not selecting a winner**, not about the two fields sitting next to each other on the
form — so a future change that gives a gate its own column does not, by itself, satisfy it
unless the collapse rule for both halves moves together, in the same change, from
first-non-empty-wins to something that never picks a winner.

The special-occasion pair is the first one collapsed that way (2026-08-13,
`registrationText.specialOccasions` in `family_camp_registration_text.go`): the two fields
are accumulated per answering person and deduplicated as one unit, so one parent's answer
fanned onto three children still collapses to a single value while two members who each
answered keep both explanations beside the gate that member gave. The other four pairs
measured above (Special Needs, CPAP, Housing Accommodation, Bathroom) still collapse
independently in `processMedical` — that is kindred#2255. Allergies, Dietary Needs and
`Family Camp-Physician ` are not merely the same shape on the form: `processMedical`
concatenates each one's stored gate string with its stored explanation exactly as it does
for Special Needs and CPAP, so they are in the same splice class and any fix has to cover
them. They are not measured in the table above — which is why the ceiling is stated as the
highest *measured* one. Adult-Bathroom's collapse behavior has not been measured here
either.

---

## 5. Inferred option vocabularies

The API supplies no option list, so these are observed from stored values and must be
re-derived when a form changes. Counts are lifetime unless noted.

**`Family Camp-Special Needs` (182696)** — pure binary, matching the stated type:
`No` 5,379 · `Yes` 784.

**`Family Camp-CPAP` (171577)** — pure binary: `No` 3,279 · `Yes` 223.

**`FAM CAMP-CPAP` (256582), Registration form — a different question, multi-option:**

| Option | Means |
|--------|-------|
| `No` | — |
| `Yes` | power |
| `Yes, outlet needed for CPAP machine` | power |
| `Yes, bathroom or other housing accommodation for a medical (not CPAP related) or accessibility-related reason needed` | bathroom |
| `Yes, we need an outlet for a CPAP machine AND need a bathroom or other housing accommodation ...` | power + bathroom |

> **The two CPAP fields are concurrent, not sequential — so the `break` is wrong.**
> A comment in `family_camp_derived.go` calls 171577 and 256582 "generations of the same
> question" and uses that to justify a `break` letting 171577 win the `cpap_info`
> narrative slot.
>
> **CORRECTED 2026-08-13 — 256582's question text is now known, and the real shape is a DATED
> SPLIT.** The live Registration form asks *"Is anyone in your family bringing a CPAP machine to
> Camp **that requires an outlet**?"* as a plain boolean. The multi-option vocabulary below is
> **historical**: it ran in 2025, when 256582 was one combined question covering CPAP *and*
> bathroom *and* accommodation. Measured by year — 2025: 56 "outlet needed", 51 "bathroom or
> other housing accommodation", 12 "outlet AND bathroom", 757 `No`. 2026: 623 `No`, 44 plain
> `Yes`, and one residual of each multi-option string. The bathroom and accommodation gates were
> split out into `FAM CAMP-bathroom` (274056) and `Housing Accommodation` (274057), whose first
> values are 2025, with their explain twins arriving in 2026.
>
> **Consequence for `classifyCPAPAnswer`: a 2026 `Yes` means outlet-only, while a 2025
> "Yes, bathroom or other housing accommodation…" means no CPAP at all.** Code that treats 256582
> uniformly across years is reading two different questions. The conclusion below — that the
> `break` is wrong — still holds; the reasoning is now the split rather than "concurrent
> questions of differing scope".
>
> *(Original note, retained because its evidence stands:)* 256582's question text was unknown — it sits on the Registration form, which had not
> been located (see [§3](#3-the-family-camp-information-form)). Two observations settle
> the precedence anyway, without it:
>
> - **They co-occur at scale.** Same person, same year, both answered: 12 (2024), **619
>   (2025)**, **343 (2026)**. Sequential generations would show ~0. 171577 also has values
>   back to 2021 while 256582 starts in 2024, so they run concurrently, not in series.
> - **Their scopes differ, provably.** One of 256582's options reads *"bathroom or other
>   housing accommodation for a medical (**not CPAP related**) or accessibility-related
>   reason needed"*. A question meaning *"is anyone bringing a CPAP machine?"* cannot have
>   an answer meaning *"no CPAP, but I need a bathroom"*.
>
> Whatever 256582 asks, it is broader than 171577 and its options carry the need; 171577
> stores only `Yes`/`No`. The `break` therefore lets an uninformative binary overwrite the
> sentence that names the need. Fix the comment alongside the code — but correct it to
> *"concurrent questions of differing scope"*, which is what the evidence supports, not to
> a claim about the Registration form's wording, which nobody has read.

**`FAM CAMP-Shared Cabin` (263379)** — four checkboxes, pipe-delimited when more than one
is ticked: share *with* a specific family · share *with* a family with similarly aged kids
· house *near* a specific family · no requests. NEAR and WITH are different edge types —
proximity is satisfied by map distance, co-housing by sharing a slot — and a household can
tick both.

---

## 6. The adult transcription chain

```text
per-child (Camper partition)                      household (Family partition)
  Family Camp-P1 First Name   (34160)   ──┐
  Family Camp-P2 First Name   (34161)   ──┼── hand-retyped by ──▶  Family Camp Adult 1-5
  Family Camp-Additional Adults (36525) ──┘   CampMinder vendor      (219270-219272,
                                                                      221653, 221654)
```

Facts worth not rediscovering:

- `Family Camp-P1/P2 Last Name` (216785 / 216786) died after 2022 — 445 values that year,
  then 1 / 3 / 2 / 0. Post-2022 the only camper-level source is the "First Name" field,
  which in practice holds a **full typed name** (773 of 788 2026 values contain a space).
- `Family Camp Name 3` (34162) has **zero values in every year**, so there is no
  camper-level source for adults 3+ except the free-text `Additional Adults`.
- `Family Camp-Additional Adults` (36525) is admitted into the field map and then routed
  nowhere. Hand-transcription is the *only* path from it to the product, and nothing
  compares source to target.
- **Slot number is not an identity.** Roughly one adult in five occupies a different
  `adult_number` between consecutive years, and slot 1 holds a different person in 25-34%
  of returning households. Never join on `adult_number` across years.
- Wrong *dedup* is essentially absent — one household-year in three years has the same
  name in two slots. The defect is **under-transcription**: ~45% of households naming
  additional adults end up with no slot 3-5 at all.

---

## 7. Standing traps

- **Match on `cm_id`, never the display name.** Staff rename fields. One shipped field
  (`Family Camp-Physician `, 39680) still carries a trailing space; `normalizeFieldName`
  exists because of it. The adult pipeline currently violates this and routes on
  display-name substrings.
- **Two live fields differ by one letter.** `Housing Accommodation` (274057, Camper) and
  `Housing Accomodation` (274055, Adult) are not a typo to correct.
- **A field can be admitted and still routed nowhere.** "The value is in
  `person_custom_values`" and "a transform routes it into a column something reads" are
  different claims, and conflating them is the most common error in this area.
- **The registration and information forms ask overlapping questions.** Where both are
  answered, precedence must be deliberate and documented, not incidental to load order.
- **Adult-partition answers have no child row**, so a per-child report structurally cannot
  show them. 18 of 63 households flagged for a private bathroom in 2026 are flagged only
  because of an adult.
