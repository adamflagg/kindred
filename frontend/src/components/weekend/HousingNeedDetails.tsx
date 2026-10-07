/**
 * The household's housing needs, each row carrying the family's own words.
 *
 * ## Why this is not `AccessibilityFlagList`
 *
 * `AccessibilityFlagList` renders once per roster row, 62 to a page, so it
 * must never acquire the medical hook — 62 rows would fire 62 gated requests.
 * This component exists only inside `FamilyDetailsPanel`, which shows ONE
 * household, and the roster never imports it. A component that cannot be
 * mounted on 62 rows cannot make 62 requests: the guarantee is a fact about
 * the module graph rather than a rule someone has to remember.
 *
 * That is a REQUEST-VOLUME boundary, not a privacy one. Private data --
 * health information included -- is gated behind `bunking.manage` and nothing
 * else; kindred#2312 removed the separate `lodging.phi` permission because
 * "RBAC here is screen-reduction, not a data boundary".
 *
 * ## One calculation, both surfaces
 *
 * `needExplainTexts` is the same mapping the board's glyph tooltips use. This
 * renders it inline instead of in a bubble; nothing is re-derived here.
 *
 * ## The merge (kindred#2255, superseded in place)
 *
 * The need and its explain used to render twice in this section -- the gate as
 * an amber row from `family_camp_registrations`, the narrative as a red row
 * from `family_camp_medical`, one directly below the other. Measured on the
 * 2026 roster they fired on exactly the same households: bathroom 42/42,
 * accommodation 29/29, zero on either side alone. #2255 proposed collapsing
 * the duplicate behind a click; this removes it.
 *
 * NO GATE PILL. The row renders because the gate was Yes, so a pill restates
 * the row's own existence -- `cpap_gate = yes` matched `needs_power` 29 of 29.
 * NO SEVERITY FILL, because the glyph carries the ink and the board struck the
 * `need` amber tone. The blocker is the one exception.
 *
 * ## An adult guest's words (2026-10-07)
 *
 * Two sources, each tagged. CampMinder's Accommodation-Explain is read PER
 * PERSON (`usePersonNeedNarrative`), never from the household's medical row,
 * which can carry another weekend's or another person's answer. The latest
 * Jotform filing's comment (`jotformAccommodation`) shows whatever registration
 * says: the form had no conditional logic on it for 2026, so guests answered No
 * and still wrote a real need. It prints once, under its Jotform line.
 */
import { HandHeart, HandHelping, ShieldAlert, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { Permission } from '../../constants/permissions'
import { usePermissions } from '../../hooks/usePermissions'
import { useHouseholdMedical, usePersonNeedNarrative } from '../../hooks/useWeekendRoster'
import type {
  HouseholdMedical,
  JotformAccommodationRow,
  JotformNeedAnswerRow,
  RosterPartyRow,
} from '../../types/lodging'
import { shortDate } from './bunkingRequest'
import { ANSWER_PILL_CLASS, ANSWER_PILL_TONE } from './answerPill'
import { askedNeedGlyphs, needExplainTexts } from './needGlyphs'
import { Section } from './PanelSection'
import { ProvenanceTag } from './panelRows'

export interface HousingNeedDetailsProps {
  party: RosterPartyRow
  /** The household whose medical narrative to read. `null` for an adult
   *  weekend guest: a guest does have a household, but its row is the wrong
   *  source -- it can hold another weekend's or another person's answer
   *  (`adult_need_answers.py`) -- so a guest's words come by `personCmId`. */
  householdCmId: number | null
  /** An adult weekend guest's own CampMinder id, for their own narrative. */
  personCmId?: number | null | undefined
  year: number
  /** kindred#2759: where the guest's Jotform disagrees with registration. Adult guests only. */
  jotformSays?: readonly JotformNeedAnswerRow[] | undefined
  /** The latest filing's accommodation answer and comment, agreeing or not. Adult guests only. */
  jotformAccommodation?: JotformAccommodationRow | null | undefined
  /** kindred#2759: tags every row with its source ("Registration") when a second source sits beside it. */
  sourceTag?: string | undefined
  /** Draw a titled section around the rows -- and nothing, heading included,
   *  when there are none (owner ruling 2026-10-07: no empty headings). */
  title?: string | undefined
}

interface PanelRow {
  key: string
  label: string
  Icon: LucideIcon
  hueClassName: string
  texts: string[]
  isBlocker?: boolean
}

/** What one Jotform line under a need says. `registration` is set only where
 *  the two disagree; `answer` is `''` for an unanswered question. */
interface JotformLine {
  need: JotformNeedAnswerRow['need']
  answer: string
  registration?: string | undefined
  submittedAt: string
  details: string
}

/**
 * The muted Jotform line under a registration need (kindred#2759). Context
 * only: registration still drives the glyphs. The answer is a Yes/No pill in
 * `SharePreferenceChip`'s grammar and tones, after the Jotform source tag --
 * no "Jotform says" prefix, which the tag already says (owner review
 * 2026-09-24). The pill shows on agreement too, so a guest who ticked No and
 * wrote a need reads as exactly that (owner ruling 2026-10-07). The guest's
 * comment is its own paragraph below, printed once -- never on the pill line.
 */
function JotformSays({ line }: { line: JotformLine }) {
  const tone = line.answer === 'Yes' ? ANSWER_PILL_TONE.yes : ANSWER_PILL_TONE.no
  return (
    <>
      <p
        data-testid={`jotform-says-${line.need}`}
        className="text-muted-foreground flex flex-wrap items-center gap-1.5 pl-6 text-xs"
      >
        {/* The `{' '}`s draw nothing inside the flex row (gap spaces it); they
            keep the line's copied text and textContent readable. */}
        <ProvenanceTag>{`Jotform · ${shortDate(line.submittedAt)}`}</ProvenanceTag>{' '}
        {line.answer.length > 0 && (
          <span
            data-testid={`jotform-answer-${line.need}`}
            className={`${ANSWER_PILL_CLASS} ${tone}`}
          >
            {line.answer}
          </span>
        )}{' '}
        {line.registration !== undefined && <span>{`(registration: ${line.registration})`}</span>}
      </p>
      {line.details.length > 0 && (
        <p
          data-testid={`jotform-details-${line.need}`}
          className="text-foreground/85 pl-6 text-sm whitespace-pre-wrap"
        >
          {line.details}
        </p>
      )}
    </>
  )
}

export function HousingNeedDetails({
  party,
  householdCmId,
  personCmId,
  year,
  jotformSays,
  jotformAccommodation,
  sourceTag,
  title,
}: HousingNeedDetailsProps) {
  const { hasPermission } = usePermissions()
  const mayRead = hasPermission(Permission.BUNKING_MANAGE)
  const flags = party.flags
  const mandatory = flags?.accommodation_is_mandatory === true
  const hasAccommodationRow = mandatory || flags?.needs_accommodation === true

  const canReadHousehold = mayRead && householdCmId !== null
  const household = useHouseholdMedical(year, householdCmId, canReadHousehold)
  // A guest's narrative is Accommodation-Explain alone, and only the
  // Accommodation row holds it -- so a guest without that row asks for
  // nothing, and every adult row is painted before any fetch settles.
  const canReadPerson =
    mayRead && householdCmId === null && (personCmId ?? null) !== null && hasAccommodationRow
  const person = usePersonNeedNarrative(year, personCmId ?? null, canReadPerson)
  const canRead = canReadHousehold || canReadPerson
  const data: Partial<HouseholdMedical> | undefined = canReadHousehold
    ? household.data
    : canReadPerson
      ? person.data
      : undefined
  const error = canReadHousehold ? household.error : canReadPerson ? person.error : null
  const isLoading = canReadHousehold ? household.isLoading : canReadPerson && person.isLoading

  // A paragraph already rendered under an earlier row is never repeated
  // under a later one. `accommodation_explain` is read directly by the
  // accommodation/blocker row below AND returned again by `needExplainTexts`
  // for BOTH `fridge` and `step_free` (`needGlyphs.ts` lists it as the sole
  // `explainSources` for each) -- so a household asking for accommodation, a
  // fridge and a step-free room used to see the identical paragraph under
  // three consecutive labels. Measured on the 2026 roster's 392 rostered
  // households: 10 see it repeated -- 9 twice, 1 three times -- which is all
  // 6 fridge households and 5 of the 7 step-free ones. This is the same
  // defect the owner ruled on 2026-08-23 for `bathroom_explain`/`step_free`
  // (see `needGlyphs.ts`'s own note on that ruling): one glyph, one
  // paragraph, never re-quoted under a second label. THE ROW STILL RENDERS
  // regardless of this -- the glyph and label are what carry the need; only
  // the duplicate TEXT is suppressed. `needExplainTexts` stays the single
  // calculation; nothing here re-derives which field explains which need.
  //
  // INVARIANT: `dedupe()` MUTATES `seenTexts`, so it must only run for a row
  // that is actually about to be pushed. A round-1 version of this fix called
  // it unconditionally while computing `accommodationText`, before the
  // `mandatory`/`needs_accommodation` branch below decided whether any row
  // would consume it -- so a household with NEITHER flag set still poisoned
  // `seenTexts` with `accommodation_explain`, and a later `fridge` or
  // `step_free` row (both read the same field through `needExplainTexts`)
  // rendered with zero text instead of one paragraph. That combination is
  // LATENT rather than live, but not because every household is gated:
  // `AccessibilityFlagSummary`'s own schema comment (`api/schemas/lodging.py`)
  // documents `needs_fridge`/`needs_step_free` as NOT GATED on
  // `needs_accommodation` as a CODE decision, and on the rostered 392 cohort
  // fridge IS fully gated (6 of 6) but step-free is NOT (5 of 7; 11 of 14
  // across all 481 2026 registrations) -- 2 of the 7 rostered step-free
  // households (3 of 14 overall) raise no `needs_accommodation` at all. What
  // actually keeps this latent is narrower: both of those 2 rostered ungated
  // households have an EMPTY `accommodation_explain` and narrate through
  // `bathroom_explain` instead, so there is currently nothing in that field
  // for a poisoned `seenTexts` to swallow -- zero households on either
  // cohort hit the failing combination. Nothing in the data model enforces
  // that emptiness, though -- the Family Camp Information form is a
  // re-submittable, per-child "drift engine"
  // (`docs/reference/family-camp-field-provenance.md` §3c), so one of those
  // two households writing into the accommodation box instead turns this
  // live. That is why `rawAccommodationText` below stays UNDEDUPED, and
  // `dedupe()` is called only inside the branch that pushes the row
  // consuming it.
  const seenTexts = new Set<string>()
  const dedupe = (texts: string[]): string[] =>
    texts.filter((text) => {
      if (seenTexts.has(text)) return false
      seenTexts.add(text)
      return true
    })

  const rawAccommodationText = canRead
    ? [(data?.accommodation_explain ?? '').trim()].filter(Boolean)
    : []

  const rows: PanelRow[] = []

  // 1. The blocker: "I am only able to attend with this accommodation in
  //    place." True for 2 of 392 rostered 2026 households, and the single
  //    highest-stakes fact in this section.
  if (mandatory) {
    rows.push({
      key: 'blocker',
      label: 'Accommodation required',
      Icon: ShieldAlert,
      hueClassName: 'text-red-500 dark:text-red-400',
      texts: dedupe(rawAccommodationText),
      isBlocker: true,
    })
  } else if (flags?.needs_accommodation === true) {
    // 2. The gate without the blocker. NOT `Accessibility` -- that is the
    //    board's step-free glyph, and drawing it here would put one icon on
    //    two meanings on adjacent rows.
    rows.push({
      key: 'accommodation',
      label: 'Accommodation',
      Icon: HandHelping,
      hueClassName: 'text-rose-500 dark:text-rose-400',
      texts: dedupe(rawAccommodationText),
    })
  }

  // 3-6. The four graded needs, in NEED_GLYPHS order, with their own words.
  for (const glyph of askedNeedGlyphs(party)) {
    rows.push({
      key: glyph.key,
      label: glyph.label,
      Icon: glyph.Icon,
      hueClassName: glyph.hueClassName,
      texts: canRead ? dedupe(needExplainTexts(glyph.key, data)) : [],
    })
  }

  // 7. Special needs -- the one row with no flag behind it. It renders on
  //    text alone, which is why it disappears entirely without the
  //    permission. Deliberately NOT a NEED_GLYPHS entry: an entry there would
  //    draw on the board card too, and the board shows four graded needs.
  const specialNeedsText = canRead ? (data?.special_needs_info ?? '').trim() : ''
  const specialNeeds = dedupe(specialNeedsText.length > 0 ? [specialNeedsText] : [])
  if (specialNeeds.length > 0) {
    rows.push({
      key: 'special_needs',
      label: 'Special needs',
      Icon: HandHeart,
      hueClassName: 'text-rose-500 dark:text-rose-400',
      texts: specialNeeds,
    })
  }

  // THE ONE CASE WHERE SILENCE IS AMBIGUOUS, and the exception to the
  // no-spinner rule below. Rows 1-6 paint immediately off roster booleans, so
  // a pending fetch is invisible for a household that asks for anything at
  // all. `Special needs` is different: it is the only row with no flag behind
  // it and renders on TEXT alone, so a household whose sole disclosure is
  // `special_needs_info` renders NOTHING until the query settles -- and an
  // empty section is exactly what "nothing on file" looks like. That is 18 of
  // the 392 rostered 2026 households, so it is not a corner case.
  //
  // GATED ON `canRead` EXPLICITLY, not left to the query's `enabled` flag.
  // React Query does report `isLoading: false` for a disabled query, so this
  // is belt-and-braces today -- but "a viewer without the permission is never
  // told a fetch is happening" is this component's rule to keep, not a
  // library detail to inherit. A refactor that moved the `enabled` guard
  // would otherwise show them a spinner for a request nobody made; a test
  // pins that.
  // kindred#2759. A Jotform answer that differs from registration hangs under
  // the row it concerns; one with no registration row (Jotform says Yes,
  // registration said No or nothing) gets its own row, never dropped. Since
  // 2026-10-07 the accommodation comment does the same whether or not the two
  // agree.
  const saysByNeed = new Map((jotformSays ?? []).map((says) => [says.need, says]))
  const accommodationSays = saysByNeed.get('accommodation')
  const accommodationDetails = (jotformAccommodation?.details ?? '').trim()
  const accommodationLine: JotformLine | undefined =
    accommodationSays !== undefined
      ? {
          need: 'accommodation',
          answer: accommodationSays.jotform,
          registration: accommodationSays.registration,
          submittedAt: accommodationSays.submitted_at ?? '',
          details: accommodationDetails,
        }
      : accommodationDetails.length > 0 && jotformAccommodation
        ? {
            need: 'accommodation',
            answer: jotformAccommodation.answer ?? '',
            submittedAt: jotformAccommodation.submitted_at ?? '',
            details: accommodationDetails,
          }
        : undefined
  const cpapSays = saysByNeed.get('cpap')
  const cpapLine: JotformLine | undefined =
    cpapSays !== undefined
      ? {
          need: 'cpap',
          answer: cpapSays.jotform,
          registration: cpapSays.registration,
          submittedAt: cpapSays.submitted_at ?? '',
          details: '',
        }
      : undefined
  const lineFor = (rowKey: string): JotformLine | undefined =>
    rowKey === 'accommodation' || rowKey === 'blocker'
      ? accommodationLine
      : rowKey === 'power'
        ? cpapLine
        : undefined
  const rowKeys = new Set(rows.map((row) => row.key))
  const orphans = [
    {
      label: 'Accommodation',
      line: accommodationLine,
      registration:
        accommodationSays?.registration ?? jotformAccommodation?.registration ?? 'blank',
      covered: rowKeys.has('accommodation') || rowKeys.has('blocker'),
    },
    {
      label: 'Power (CPAP)',
      line: cpapLine,
      registration: cpapSays?.registration ?? 'blank',
      covered: rowKeys.has('power'),
    },
  ].flatMap(({ line, ...entry }) =>
    line !== undefined && !entry.covered ? [{ ...entry, line }] : []
  )
  const titled = (node: ReactNode) =>
    title === undefined ? node : <Section title={title}>{node}</Section>

  if (rows.length === 0 && orphans.length === 0 && error === null && canRead && isLoading) {
    return titled(
      <p data-testid="housing-need-loading" className="text-muted-foreground text-sm">
        Loading housing needs…
      </p>
    )
  }

  // Nothing to say, and the fetch (if any) came back clean: the old
  // component's honest empty case, now discovered from the payload plus the
  // roster booleans rather than predicted by a flag.
  if (rows.length === 0 && orphans.length === 0 && error === null) return null

  return titled(
    <ul className="flex flex-col gap-2.5">
      {error !== null && (
        // NO SPINNER, deliberately asymmetric with the rows below: every row
        // above paints immediately off a roster boolean, and its label is
        // its own placeholder while the narrative loads (`needExplainTexts`'s
        // own note). A fetch failure is different -- silence there reads as
        // "the family wrote nothing" to a `bunking.manage` holder, which is
        // the wrong answer, so it gets the one line of text this component
        // renders on its own account.
        <li
          data-testid="housing-need-fetch-error"
          className="text-sm text-red-600 dark:text-red-400"
        >
          {error.message}
        </li>
      )}
      {rows.map((row) => (
        <li
          key={row.key}
          data-testid={`need-row-${row.key}`}
          className={
            row.isBlocker
              ? 'flex flex-col gap-1 rounded-r-lg border-l-[3px] border-red-400 bg-red-50 px-3 py-2 dark:border-red-500/60 dark:bg-red-900/20'
              : 'flex flex-col gap-1'
          }
        >
          <div className="flex items-center gap-2 text-sm">
            <row.Icon className={`h-4 w-4 flex-shrink-0 ${row.hueClassName}`} />
            <span
              className={
                row.isBlocker
                  ? 'font-bold text-red-700 dark:text-red-300'
                  : 'text-foreground font-semibold'
              }
            >
              {row.label}
            </span>
            {sourceTag !== undefined && <ProvenanceTag>{sourceTag}</ProvenanceTag>}
            {row.isBlocker && (
              <span className="ml-auto rounded bg-red-200 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-red-900 uppercase dark:bg-red-500/30 dark:text-red-100">
                Blocker
              </span>
            )}
          </div>
          {row.texts.map((text, index) => (
            <p
              key={`${row.key}-${String(index)}`}
              className={
                row.isBlocker
                  ? 'text-sm whitespace-pre-wrap text-red-700 dark:text-red-300'
                  : 'text-foreground/85 pl-6 text-sm whitespace-pre-wrap'
              }
            >
              {text}
            </p>
          ))}
          {(() => {
            const line = lineFor(row.key)
            return line !== undefined ? <JotformSays line={line} /> : null
          })()}
        </li>
      ))}
      {orphans.map((orphan) => (
        <li
          key={`jotform-${orphan.line.need}`}
          data-testid={`need-row-jotform-${orphan.line.need}`}
          className="flex flex-col gap-1"
        >
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground font-semibold">{orphan.label}</span>
            {sourceTag !== undefined && (
              <ProvenanceTag>{`${sourceTag}: ${orphan.registration}`}</ProvenanceTag>
            )}
          </div>
          <JotformSays line={orphan.line} />
        </li>
      ))}
    </ul>
  )
}
