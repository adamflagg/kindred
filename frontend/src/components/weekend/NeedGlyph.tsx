/**
 * One need glyph, drawn — the mark kindred#2072 exists for.
 *
 * ## Its own file because TWO surfaces draw it
 *
 * The family card draws a household's needs against the cabin it is IN; the
 * Assign modal draws a candidate's needs against the cabin being CONSIDERED
 * (`needGlyphs.ts`'s `prospective` reading). Same mark, same rules, one
 * implementation.
 *
 * That split is the lesson from the `Whole building` chip, which lived inside
 * `FamilyCard.tsx` unexported and was therefore REPRODUCED in
 * `MapUnitPopover.tsx` — "same label, same tokens, same icon" by hand, with a
 * comment admitting the copy. Two copies drift; this one cannot.
 *
 * `needGlyphs.ts` stays pure TypeScript and holds the vocabulary and the
 * grading; this holds the markup. A rule with a truth table is testable
 * without rendering ~82 cards, which is why the two are not one file.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Permission } from '../../constants/permissions'
import { useYear } from '../../hooks/useCurrentYear'
import { usePermissions } from '../../hooks/usePermissions'
import { useHouseholdMedical } from '../../hooks/useWeekendRoster'
import { Tooltip } from '../ui/Tooltip'
import { needExplainTexts, type NeedKey, type ResolvedNeedGlyph } from './needGlyphs'

/**
 * The warn ink, owned here because the GLYPH is what defines it (N2) and a
 * word chip merely borrows it.
 *
 * `FamilyCard`'s `CHIP_TONE.warn` reads this constant rather than repeating
 * the string: the glyph replaced the `No power` chip that used to sit beside
 * it, and two reds for one meaning is how a palette stops meaning anything.
 * A complete literal, because Tailwind scans raw source text and a composed
 * class name emits no rule at all (#1894).
 */
export const WARN_TONE = 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300'

/**
 * The unmet glyph: warn fill, warn BORDER, warn icon.
 *
 * The border is what distinguishes it from a word chip wearing the same fill —
 * an icon-only mark is small, and a fill alone at this size reads as a smudge.
 * The review mock sets `border-color: var(--warn-fg)`, which is this
 * `text-red-800` step on the light side and `red-300` on the dark.
 */
const GLYPH_UNMET = `${WARN_TONE} border-red-800 dark:border-red-300`

/**
 * The icon-only chip is a GEOMETRY, not a seventh tone.
 *
 * Transparent ground, a 1px border in the card's own border token, and a
 * SQUARE 20×20 box — it composes with `GLYPH_UNMET` above for the unmet state
 * rather than being a variant of it. `rounded-lg` rather than the word chips'
 * `rounded-full`: a circle around a 12px glyph reads as a bullet, and the
 * shape difference is what says "this is a need, not a preference".
 *
 * ⚠️ 20px IS THE WORD CHIPS' OWN HEIGHT, and matching it is the point. This
 * was `p-0.5`, which is 18px — two pixels shorter than every chip it shares a
 * line with, which reads as a misalignment rather than as a smaller mark. The
 * review artifact reaches 20 with 3px of padding; `h-5 w-5` reaches it on
 * Tailwind's own scale, with `justify-center` doing what the padding did.
 *
 * It also closes a 2px overlap: `ui/Tooltip`'s invisible 24px hit target
 * overhung an 18px glyph by 3px a side against a 4px gap, so adjacent glyphs'
 * hit areas collided and the later one in the DOM won.
 *
 * EXPORTED for the family card's child-under-two mark (staff ruling,
 * 2026-08-21), which shares the chip row and must share this geometry — it is
 * an UNGRADED mark, not a fifth glyph, so it borrows the frame and nothing
 * else. Same drift argument as WARN_TONE above: one geometry, one definition.
 */
export const GLYPH_BASE = 'inline-flex h-5 w-5 items-center justify-center rounded-lg border'

/**
 * ICON-ONLY, and that is the ruling rather than a space saving: four needs
 * wearing four hues read as a gutter a staff member scans, where four word
 * chips wrapped the card and pushed the sharing chips onto a third line. The
 * SHAPE says which need it is, which is what makes losing the hue affordable
 * when the glyph goes to warn (N2).
 *
 * A REACHABLE tooltip, not a `title`: `title` fires on mouse hover and nothing
 * else (kindred#2177), and a mark with no words is unreadable without one.
 * Valid HTML on the family card because the chip row is a SIBLING of the
 * card's own `<button>`, never its child (kindred#2222) — the same thing that
 * let "Answers disagree" grow a real trigger in kindred#2250.
 *
 * ⚠️ `insideControl` EXISTS BECAUSE THAT SIBLING RULE HAS A SECOND CONSUMER
 * THAT CANNOT HONOUR IT, and ignoring it cost a silent write.
 *
 * The Assign modal draws these marks inside a candidate ROW, and the row is
 * itself a `<button>` that places the family. A `ui/Tooltip` trigger is also a
 * real `<button>`, so the mark nested one control inside another: invalid
 * HTML, and — because the trigger does not stop propagation — a staff member
 * clicking a glyph to read what it meant PLACED that family and closed the
 * modal.
 *
 * Where the mark cannot be a sibling, it must not be a control. `insideControl`
 * renders a plain `<span>` carrying a native `title` instead. That is a
 * deliberate, scoped return to the attribute kindred#2177 replaced, and it is
 * affordable for exactly one reason: `title` is mouse-only, and the board's
 * audience is mouse-only (owner ruling, 2026-08-20). Do not widen it to the
 * family card, where the sibling shape makes a real trigger possible.
 *
 * ⚠️ THE TOOLTIP DOES NOT DISTINGUISH `partial`. Two glyph states are ruled,
 * not three (§2), and inventing a third word here would be the same collapse
 * a third colour would be. `partial` — "a ramp with a lip", "some rooms have
 * power" — reads as met; degree lives on the card's drag-time hatch, which
 * grades it on the hatch period.
 *
 * ## The tooltip may carry the family's OWN WORDS, fetched — never carried
 *
 * For a `bunking.manage` holder the card's tooltip appends the explain text
 * the glyph's flag was derived from (`explainSources` in `needGlyphs.ts`),
 * fetched through the gated medical endpoint ONLY once the bubble is open —
 * see `explainHouseholdCmId`'s doc and `NeedGlyphExplainProbe` for the
 * containment and timing rules. The `insideControl` span takes no part in
 * this: a native `title` is set once at render and cannot load anything, and
 * eagerly fetching medical text for every candidate row in the Assign modal
 * is precisely the speculative read the lazy path exists to avoid.
 */
export function NeedGlyphMark({
  glyph,
  insideControl = false,
  explainHouseholdCmId = null,
}: {
  glyph: ResolvedNeedGlyph
  /**
   * The mark is being drawn INSIDE another control, so it must not be one
   * itself. See the nesting hazard in this module's doc.
   */
  insideControl?: boolean
  /**
   * The household whose OWN WORDS the tooltip may append under the label,
   * for a `bunking.manage` holder — the family's `bathroom_explain` /
   * `cpap_info` / `accommodation_explain`, the very fields the glyph's flag
   * was derived from (`needGlyphs.explainSources`).
   *
   * ⚠️ THE TEXT IS FETCHED, NEVER CARRIED. `HouseholdMedicalResponse` is
   * deliberately fenced OUT of the roster payload (the medical-narrative
   * containment test and its Go parity list); this prop is only the ID to
   * fetch it BY, and the fetch happens through the same gated
   * `useHouseholdMedical` the details panel uses — mounted only while the
   * bubble is open, so nothing is requested for a card nobody asked about
   * and nothing sits in the cache once the bubble closes (`gcTime: 0`).
   *
   * `null`/`0` — a person-grain party, or a caller with no household —
   * means today's label tooltip, no fetch, no permission read. Meaningless
   * with `insideControl`, whose native `title` cannot load anything.
   */
  explainHouseholdCmId?: number | null
}) {
  const { Icon, label, hueClassName, isUnmet } = glyph
  const sentence = isUnmet ? `${label} — the cabin does not meet it` : label
  const icon = (
    <Icon className={`h-3 w-3 ${isUnmet ? 'text-red-800 dark:text-red-300' : hueClassName}`} />
  )
  const className = `${GLYPH_BASE} ${isUnmet ? GLYPH_UNMET : 'border-border bg-transparent'}`

  // The lazy-explain state. Hooks before the `insideControl` return, per the
  // rules of hooks; they cost nothing there because `canExplain` is false and
  // the probe below never mounts.
  const canExplain = !insideControl && (explainHouseholdCmId ?? 0) > 0
  const [bubbleOpen, setBubbleOpen] = useState(false)
  const [explainTexts, setExplainTexts] = useState<readonly string[]>([])
  const handleOpenChange = useCallback((open: boolean) => {
    setBubbleOpen(open)
    // Closing DROPS what the probe brought: the probe unmounts (taking the
    // cached payload with it — `gcTime: 0`), and a paragraph held here would
    // outlive that on a mark that sits on the board for hours. The next open
    // refetches; until it lands, the label is the placeholder.
    if (!open) setExplainTexts([])
  }, [])

  if (insideControl) {
    return (
      <span className={className} title={sentence} data-testid={`need-glyph-${glyph.key}`}>
        {icon}
      </span>
    )
  }

  const content =
    explainTexts.length === 0 ? (
      sentence
    ) : (
      <>
        <div>{sentence}</div>
        {explainTexts.map((text, index) => (
          // Index keys, deliberately: two sources can legitimately carry
          // identical text, and the list is rebuilt whole on every change.
          <p key={index} className="text-muted-foreground mt-1 whitespace-pre-wrap">
            {text}
          </p>
        ))}
      </>
    )

  return (
    <>
      {canExplain && bubbleOpen && (
        <NeedGlyphExplainProbe
          needKey={glyph.key}
          householdCmId={explainHouseholdCmId as number}
          onTexts={setExplainTexts}
        />
      )}
      <Tooltip
        content={content}
        onOpenChange={canExplain ? handleOpenChange : undefined}
        // ★ NAMED, and this is a hard requirement of the change rather than an
        // accessibility flourish. After kindred#2072 the strings "Private
        // bathroom" and "Power" appear NOWHERE on the family card — the glyph is
        // the only carrier — so a trigger with no accessible name is a control
        // that announces nothing and a `getByRole('button', { name })` query
        // that cannot find it. `frontend/CLAUDE.md` puts it plainly inside the
        // opt-out policy: "An icon-only button needs a name — give it one", and
        // `ui/Tooltip`'s own `aria-label` doc scopes itself to exactly this case
        // — a trigger whose visible content does not name it.
        //
        // The SENTENCE stays the whole name when the explain paragraphs load:
        // the name is what identifies the control, and a medical narrative in
        // every `getByRole` dump would be kindred#2348's find-in-page leak
        // reborn one layer up.
        aria-label={sentence}
        data-testid={`need-glyph-${glyph.key}`}
        className={className}
      >
        {icon}
      </Tooltip>
    </>
  )
}

/**
 * MOUNTED ONLY WHILE THE BUBBLE IS OPEN, and that timing is the whole design:
 *
 *   - card render is not interaction, so ~82 cards mount nothing and fetch
 *     nothing — the speculative read `useHouseholdMedical`'s `enabled` flag
 *     exists to prevent;
 *   - a user without `bunking.manage` returns before the fetch component
 *     exists, so there is no disabled query either — no medical request is
 *     made, or even prepared, on behalf of someone who cannot have the
 *     answer (`MedicalNarrative`'s rule, one panel further out);
 *   - closing the bubble unmounts the query, and `useHouseholdMedical`'s
 *     `staleTime: 0, gcTime: 0` — the documented privacy divergence — then
 *     drops the payload from the cache at once. The narrative lives exactly
 *     as long as somebody is looking at it.
 *
 * Split in two because hooks cannot be conditional: this half reads the
 * permission and returns before its child's `useHouseholdMedical` ever
 * mounts for a non-holder.
 */
function NeedGlyphExplainProbe({
  needKey,
  householdCmId,
  onTexts,
}: {
  needKey: NeedKey
  householdCmId: number
  onTexts: (texts: readonly string[]) => void
}) {
  const { hasPermission } = usePermissions()
  if (!hasPermission(Permission.BUNKING_MANAGE)) return null
  return <NeedGlyphExplainFetch needKey={needKey} householdCmId={householdCmId} onTexts={onTexts} />
}

/** The gated fetch itself — see `NeedGlyphExplainProbe` for when this exists. */
function NeedGlyphExplainFetch({
  needKey,
  householdCmId,
  onTexts,
}: {
  needKey: NeedKey
  householdCmId: number
  onTexts: (texts: readonly string[]) => void
}) {
  const year = useYear()
  // `year > 0`: `CurrentYearContext` reports the literal 0 until the backend
  // supplies the configured year — the same guard every useWeekendRoster
  // hook carries. Errors (a 403 that arrives anyway, `retry: false`) leave
  // `data` undefined, which reads as "no explain": the label-only tooltip,
  // never an error state in a bubble.
  const { data } = useHouseholdMedical(year, householdCmId, year > 0)
  const texts = useMemo(() => needExplainTexts(needKey, data), [needKey, data])
  useEffect(() => {
    onTexts(texts)
  }, [texts, onTexts])
  return null
}
