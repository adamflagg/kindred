/**
 * The request panel must distinguish NEAR from WITH and must never imply a
 * household consented to sharing when they simply did not answer.
 *
 * The vocabulary here is Go's, not this layer's: `no_share | maybe_mutual |
 * yes_share`, with an empty column arriving as `unknown`.
 *
 * ## The free text is SPLIT now (kindred#2330)
 *
 * This file used to state, as its contract, that `request_text` is ONE
 * pre-joined string that is never split back apart. That is still true of
 * `request_text` itself — the ingest joins its source fields with `'; '` and
 * 10 of 422 non-blank 2026 values contain that separator themselves, so the
 * join really is irreversible — but it is no longer what the panel renders.
 * The server sends `request_blocks` beside it: one block per source field,
 * one entry per distinct answer, every contributing child named. The
 * `request_text` tests below now exercise the FALLBACK for a payload that
 * carries the join and no blocks.
 *
 * Layout is the owner's 2026-08-17 ruling, a hybrid of two mockup options:
 * blocks start EXPANDED (nothing hidden behind a click, because a scanning
 * eye must not miss request text) and every block is COLLAPSIBLE (a staff
 * member facing the seven-entry household can fold them away). kindred#2476
 * (owner ruling 2026-08-21) tunes this: `Share Bunk With` starts COLLAPSED --
 * see the `describe('Share Bunk With and Internal Bunk Notes start
 * collapsed...')` block below. A follow-up staff ruling (2026-08-21) adds
 * `Internal Bunk Notes` to that same starts-collapsed set, mirroring the
 * precedent -- every other block keeps the EXPANDED default above.
 *
 * ## Up to eight labelled rows, the owner's approved mockup (2026-08-27)
 *
 * The panel briefly shipped a board-style chip row (Tooltip-wrapped icon
 * capsule + captions above the paired text) that the brief had under-spec'd.
 * The owner's approved mockup replaced it with one `<ul>` of row kinds, the
 * SAME icon-chip/label/indented-text grammar `HousingNeedDetails` already
 * uses -- two choice rows plus up to six free-text note rows, one per
 * `REQUEST_TEXT_SOURCES` entry that carries text; "five" was this section's
 * count under an earlier, reverted design that fixed the note rows at
 * three, not a ceiling any more. `party()` below still wraps a `share()`
 * payload into a household-grain party -- taking `party`, not `share`, so
 * `resolveShareAnchor`/`resolveShareCluster`'s grain gate lives in one place
 * -- unchanged since the prior rework.
 *
 * ## A CHOICE and a NOTE are two different facts (owner ruling 2026-08-27,
 * SUPERSEDING an interim composed-label fix on the same day)
 *
 * Two rows carry NO text, ever: row 1 (the radio, always renders for a
 * household-grain party, labelled `anchor.label`) and row 2 (the checkboxes,
 * renders ONLY when a mark is ticked, labelled the ticked marks' shorthands
 * joined `' · '`). An interim fix tried lifting `Shared-request` and
 * `COVID-19 Bunking Requests` out of the fold loop to pair their TEXT under
 * these two rows -- first with captions, then with a composed label -- and
 * both were reverted: merging a note into a choice row is what let the SAME
 * field render under two different labels depending on an unrelated tick.
 * Both fields are back to being ORDINARY blocks now, flowing through the
 * SAME fold loop as the other four source fields, under their own
 * `DISPLAY_LABELS` names -- no filtering, no special casing, no
 * `share-cluster-fallback` testid (deleted; row 2 simply does not render
 * when nothing is ticked). `FAM CAMP-Share Comments` was used as a stand-in
 * for these two fields in some tests during the interim architecture; where
 * a test's fixture has been restored to the real field, its comment says so.
 *
 * ⚠️ `Shared-request` also lost its hard gate to `yes_share`/`maybe_mutual`
 * in this pass -- intended, not a bug. It renders as an ordinary block
 * whenever it has text, radio answer notwithstanding; see the tests that
 * exercise `preference: 'no_share'` alongside it below.
 *
 * The amber "quoted" rail is GONE from every text in this section --
 * `data-testid="request-entry"` elements are now plain italic, indented
 * paragraphs (mockup `.mksay`), asserted directly rather than via a
 * `className` string.
 *
 * Three tests at the bottom (`describe('a paired source field is not also
 * rendered by the joined fallback')`) are what remains of a real owner-found
 * regression fix (`c39c5599`) after this pass -- the interim
 * lifting-out-of-the-block-list architecture that bug depended on is gone,
 * so the fix dissolves naturally into "one list, not two"; the tests are
 * re-pointed at the new structure rather than deleted, because they still
 * guard the invariant that matters (a source field renders exactly once, and
 * the joined fallback fires only when NO blocks arrive at all).
 *
 * Shape it is built against, measured on the 2026 production snapshot over
 * the 382 households rostered into a family session: 270 carry any text, 142
 * of them in one source field, 90 in two, 29 in three and 9 in four; the
 * heaviest household renders seven entries across those blocks and 1,109
 * characters, in a 416px panel.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { RequestTextBlockRow, RosterPartyRow, ShareRequest } from '../../types/lodging'
import { ShareRequestPanel } from './ShareRequestPanel'

function share(overrides: Partial<ShareRequest> = {}): ShareRequest {
  return {
    preference: 'unknown',
    preference_raw: '',
    proximity: [],
    request_text: '',
    request_blocks: [],
    ...overrides,
  }
}

/**
 * Wraps a `share()` payload into a household-grain party — the shape
 * `ShareRequestPanel` now takes. Overrides are the SAME `Partial<ShareRequest>`
 * `share()` takes, so an existing call site moves by changing one word
 * (`share` -> `party`) rather than being rewritten.
 */
function party(overrides: Partial<ShareRequest> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 1000001,
    display_name: 'Johnson',
    share: share(overrides),
  }
}

function block(
  sourceField: string,
  entries: Array<{ text: string; contributors?: string[] }>,
  authorship: 'family' | 'staff' = 'family'
): RequestTextBlockRow {
  return {
    source_field: sourceField,
    authorship,
    entries: entries.map((entry) => ({ text: entry.text, contributors: entry.contributors ?? [] })),
  }
}

describe('share anchor — row 1 of the mockup', () => {
  // Replaces the board-style Tooltip/button anchor from the prior rework:
  // row 1 is no longer a `Tooltip` trigger at all, so it is queried by
  // `data-testid="share-anchor"` (the icon chip) and by its LABEL text
  // (`anchor.label`, `shareMarks.ts`'s `ShareAnchorSpec.label`) rather than
  // by button role/name.
  it('renders a hard no as the anchor\'s quiet-grey chip, labelled "Don\'t Share Cabin"', () => {
    render(<ShareRequestPanel party={party({ preference: 'no_share' })} />)
    expect(screen.getByTestId('share-anchor').className).toContain('bg-muted')
    expect(screen.getByText("Don't Share Cabin")).toBeInTheDocument()
  })

  it('renders the maybe answer as the amber chip, labelled "Maybe Share Cabin"', () => {
    render(<ShareRequestPanel party={party({ preference: 'maybe_mutual' })} />)
    expect(screen.getByTestId('share-anchor').className).toContain('bg-amber-100')
    expect(screen.getByText('Maybe Share Cabin')).toBeInTheDocument()
  })

  it('renders the yes answer as the forest chip, labelled "Yes, Share Cabin"', () => {
    render(<ShareRequestPanel party={party({ preference: 'yes_share' })} />)
    expect(screen.getByTestId('share-anchor').className).toContain('bg-forest-100')
    expect(screen.getByText('Yes, Share Cabin')).toBeInTheDocument()
  })

  it('renders an unanswered preference with its own label, not as consent', () => {
    render(<ShareRequestPanel party={party({ preference: 'unknown' })} />)
    expect(screen.getByText('Share question not answered')).toBeInTheDocument()
    expect(screen.queryByText('Yes, Share Cabin')).not.toBeInTheDocument()
  })

  it('renders no anchor row at all for a person-grain (adult-weekend) party', () => {
    // kindred, spec §6 / shareMarks.ts rule 1: an adult weekend has no share
    // question. `resolveShareAnchor` returns `null` for a person-grain party
    // and row 1 must not render at all for it -- not a dotted "unanswered"
    // chip implying a question the household was never asked.
    render(
      <ShareRequestPanel
        party={{ grain: 'person', person_cm_id: 2000001, display_name: 'Riley Sam' }}
      />
    )
    expect(screen.queryByTestId('share-anchor')).not.toBeInTheDocument()
  })

  it('never paints a declined share red', () => {
    // A smoke pin at this component's level, not the real guard -- it only
    // checks `.bg-red-100` is absent, so a stray `bg-red-50` on the anchor
    // would still pass here. `shareMarks.test.ts`'s "anchor no takes the
    // quiet-gray bg-muted treatment, never red" is the real guard: an exact
    // `toBe('bg-muted text-muted-foreground')` on `resolveShareAnchor`'s
    // className, which this component only renders verbatim.
    const { container } = render(<ShareRequestPanel party={party({ preference: 'no_share' })} />)
    expect(container.querySelector('.bg-red-100')).toBeNull()
  })
})

describe('share cluster — row 2 of the mockup', () => {
  // `share-mark-<key>` testids are unchanged from the prior rework -- still
  // one span per ticked mark, still keying `with` on `wants_with_named`
  // ALONE (shareMarks.ts's own rule -- `proximity`'s `'with'` was an OR of
  // the named tick and the similar-age tick, and reading it here would light
  // the WITH icon for a similar-age-only filing). What changed is that all
  // ticked marks now share ONE row, with ONE joined label.
  it('draws different icons for with and similar_ages, in ONE row', () => {
    render(
      <ShareRequestPanel
        party={party({
          preference: 'yes_share',
          proximity: ['with', 'similar_ages'],
          wants_with_named: true,
        })}
      />
    )
    expect(screen.getByTestId('share-mark-with')).toBeInTheDocument()
    expect(screen.getByTestId('share-mark-similar_ages')).toBeInTheDocument()
  })

  it('joins the ticked marks\' shorthands with " · " as the row label', () => {
    render(<ShareRequestPanel party={party({ proximity: ['near'], wants_with_named: true })} />)
    expect(screen.getByText('Share with family · Near family')).toBeInTheDocument()
  })

  it('labels NEAR as proximity, not co-housing', () => {
    render(<ShareRequestPanel party={party({ proximity: ['near'] })} />)
    expect(screen.getByTestId('share-mark-near')).toBeInTheDocument()
    expect(screen.queryByTestId('share-mark-with')).not.toBeInTheDocument()
    expect(screen.getByText('Near family')).toBeInTheDocument()
  })

  it('does NOT draw the WITH mark from `proximity` alone -- it needs `wants_with_named`', () => {
    render(<ShareRequestPanel party={party({ proximity: ['with'] })} />)
    expect(screen.queryByTestId('share-mark-with')).not.toBeInTheDocument()
  })

  it('draws the WITH mark from `wants_with_named`', () => {
    render(<ShareRequestPanel party={party({ wants_with_named: true })} />)
    expect(screen.getByTestId('share-mark-with')).toBeInTheDocument()
  })

  it('renders similar_ages ALONGSIDE with, never instead of it', () => {
    // similar_ages accompanies `with` on the wire -- the option it comes from
    // begins "Share a cabin WITH", and what differs is only that the partner
    // is unnamed. Dropping the WITH mark would drop these households out of
    // any "wants to share a cabin" view.
    render(
      <ShareRequestPanel party={party({ proximity: ['similar_ages'], wants_with_named: true })} />
    )
    expect(screen.getByTestId('share-mark-with')).toBeInTheDocument()
    expect(screen.getByTestId('share-mark-similar_ages')).toBeInTheDocument()
  })

  it('renders no cluster row at all when nothing is ticked', () => {
    // No fallback any more (owner ruling 2026-08-27) -- with nothing ticked
    // there is nothing to show, so row 2 simply does not render.
    render(<ShareRequestPanel party={party()} />)
    expect(screen.queryByTestId('share-mark-with')).not.toBeInTheDocument()
  })

  // 'never paints a declined share red' used to be duplicated verbatim here;
  // the anchor (row 1), not the cluster (row 2), is what carries the
  // `no_share` styling, so the one surviving copy lives in the "share
  // anchor" describe above.
})

describe('raw request text', () => {
  it('renders a joined request with no blocks as ONE verbatim block', () => {
    // The FALLBACK path since kindred#2330. `request_text` really is an
    // irreversible join, so a payload carrying it with no blocks beside it
    // still renders exactly as sent — losing a family's ask would be worse
    // than losing its provenance. Splitting this string client-side is what
    // remains impossible.
    const joined = 'Near the Garcia family; we have a toddler; ground floor please'
    render(<ShareRequestPanel party={party({ request_text: joined })} />)
    expect(
      screen.getByText(new RegExp(joined.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    ).toBeInTheDocument()
  })

  it('renders no "Needs resolution" text anywhere -- the marker was removed outright (owner ruling 2026-08-27)', () => {
    // This exact fixture -- request text with no blocks -- used to be the
    // canonical case for the badge this component no longer has: the
    // server-side field was `bool(request_text or blocks)`, so ANY request
    // text at all used to draw it. Proving the badge is gone on the fixture
    // most likely to have shown it is a stronger pin than an empty party.
    render(
      <ShareRequestPanel
        party={party({ request_text: 'Please house us near the Garcia family' })}
      />
    )
    expect(screen.queryByText(/Needs resolution/i)).not.toBeInTheDocument()
  })
})

describe('per-field split', () => {
  it('renders one labelled block per source field', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_text: 'A quiet cabin, please; Cabin with a fridge',
          request_blocks: [
            block('COVID-19 Bunking Requests', [{ text: 'A quiet cabin, please' }]),
            block('Share Bunk With', [{ text: 'Cabin with a fridge' }]),
          ],
        })}
      />
    )

    const blocks = screen.getAllByTestId('request-block')
    expect(blocks).toHaveLength(2)
    expect(blocks.map((el) => el.getAttribute('data-source-field'))).toEqual([
      'COVID-19 Bunking Requests',
      'Share Bunk With',
    ])
  })

  it('labels a block with the ORIGINAL CampMinder field name unless the owner named it', () => {
    // THE RULE IS "VERBATIM UNLESS THE OWNER NAMED IT".
    //
    // Owner ruling 2026-08-17: "call them the original fieldnames for now
    // until staff can weigh in after it's live". Staff then weighed in, in
    // two passes, and `DISPLAY_LABELS` now carries THREE exceptions --
    // `BunkingNotes Notes`, `COVID-19 Bunking Requests` and `Shared-request`
    // -- each pinned by its own test below. This test is the DEFAULT case,
    // not a dead letter: a field the owner did not name keeps the raw
    // CampMinder spelling however ugly it is, because silence is not a
    // rename. `FAM CAMP-Share Comments` is the one to hold it against -- it
    // is the retired lookalike of `Shared-request` (see that test), and it
    // was deliberately left alone while its successor was renamed.
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [block('FAM CAMP-Share Comments', [{ text: 'A quiet cabin, please' }])],
        })}
      />
    )

    expect(screen.getByText('FAM CAMP-Share Comments')).toBeInTheDocument()
  })

  it('renders `BunkingNotes Notes` as `Bunking Notes`', () => {
    // Owner review 2026-08-17, after seeing the panel live: `BunkingNotes
    // Notes` reads as a typo and gets a DISPLAY name. First of the three.
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('BunkingNotes Notes', [{ text: 'Called the family Tuesday.' }], 'staff'),
          ],
        })}
      />
    )

    expect(screen.getByText('Bunking Notes')).toBeInTheDocument()
    expect(screen.queryByText('BunkingNotes Notes')).not.toBeInTheDocument()
  })

  it('renders `COVID-19 Bunking Requests` as `Fam Info Form Bunk Notes`', () => {
    // Owner rulings 2026-08-17 (friendly names) + 2026-08-23 (corrected
    // attribution). The field is misnamed at source — nothing to do with
    // COVID — and it is the FAMILY CAMP INFORMATION form's names box
    // (provenance doc §3 row 2, staff-read; write timestamps sit a median
    // 0.0d from the shared-cabin multi's across 252 people). An ORDINARY
    // block now (owner ruling 2026-08-27) -- no proximity tick needed, no
    // pairing with row 2. It just folds like any other field.
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [block('COVID-19 Bunking Requests', [{ text: 'A quiet cabin, please' }])],
        })}
      />
    )

    expect(screen.getByText('Fam Info Form Bunk Notes')).toBeInTheDocument()
    expect(screen.queryByText('COVID-19 Bunking Requests')).not.toBeInTheDocument()
  })

  it('renders `Shared-request` as `Reg Form Bunk Notes`, even when the radio says no', () => {
    // Owner rulings 2026-08-17 (friendly names) + 2026-08-23 (corrected
    // attribution). `Shared-request` (cm_id 274133) is the REGISTRATION-time
    // comments box. It USED TO be hard-gated to the radio being yes/maybe
    // (shareMarks.ts rule 3) when it briefly paired with row 1 -- that gate
    // does NOT transfer to the ordinary-block treatment. Settled by the
    // owner, not inferred (2026-08-27): rule 3 is BOARD-tooltip-scoped, the
    // two fields were only ever conflated as an artifact of how the board's
    // tooltips happened to be built, and a standalone labelled row here was
    // never the case rule 3 was written to cover -- a note on its own row
    // under its own field label contradicts nothing, unlike appending it to
    // a compact mark that says "won't share". `preference: 'no_share'` here
    // is deliberate, not an oversight -- it is the case the old gate would
    // have hidden. It is still NOT `FAM CAMP-Share Comments` (cm_id 240598),
    // the retired lookalike, which keeps its verbatim name.
    render(
      <ShareRequestPanel
        party={party({
          preference: 'no_share',
          request_blocks: [block('Shared-request', [{ text: 'A cabin on the flat, please' }])],
        })}
      />
    )

    expect(screen.getByText('Reg Form Bunk Notes')).toBeInTheDocument()
    expect(screen.queryByText('Shared-request')).not.toBeInTheDocument()
  })

  it('always labels `COVID-19 Bunking Requests` `Fam Info Form Bunk Notes`, tick or no tick -- the defect this ruling fixes', () => {
    // Measured before this ruling on the PRODUCTION snapshot
    // (`pocketbase/pb_data/data-prod.db`, not the sibling dev `data.db`),
    // scoped to `attendees.status_id = 2`, `camp_sessions.session_type =
    // 'family'`, year 2026 (392 households): 260 households carry this
    // text -- 202 with a tick (an interim fix showed the ticked marks'
    // shorthand alone), 58 without one (the SAME interim fix showed the
    // field's friendly name alone). Same field, two different labels, 22%
    // of the time. Now: same label every time, because the note is its own
    // row, entirely separate from whether row 2 (the ticked-marks row) also
    // renders.
    const noTick = render(
      <ShareRequestPanel
        party={party({
          request_blocks: [block('COVID-19 Bunking Requests', [{ text: 'A quiet cabin, please' }])],
        })}
      />
    )
    expect(noTick.getByText('Fam Info Form Bunk Notes')).toBeInTheDocument()
    expect(noTick.queryByTestId('share-mark-near')).not.toBeInTheDocument()
    noTick.unmount()

    const withTick = render(
      <ShareRequestPanel
        party={party({
          proximity: ['near'],
          request_blocks: [block('COVID-19 Bunking Requests', [{ text: 'A quiet cabin, please' }])],
        })}
      />
    )
    // Same label on the note row, AND a SEPARATE row 2 for the tick -- the
    // two facts stay two rows, never merged back into one.
    expect(withTick.getByText('Fam Info Form Bunk Notes')).toBeInTheDocument()
    expect(withTick.getByText('Near family')).toBeInTheDocument()
    expect(withTick.getByText('A quiet cabin, please')).toBeInTheDocument()
  })

  it('relabels the DISPLAY only, and leaves every source-field identity alone', () => {
    // The keys are CampMinder field names, not captions. `REQUEST_TEXT_SOURCES`
    // keys block order and the authorship lane on them, `_may_read_staff_notes`
    // gates the two staff fields on the table they come from, and the Go
    // ingest maps them to `custom_field_defs` cm_ids and CSV slugs. A display
    // map that renamed the identity would be a data change wearing a label
    // change's clothes -- so all three relabelled fields are asserted here,
    // together, on the attribute the rest of the system reads.
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('COVID-19 Bunking Requests', [{ text: 'A quiet cabin, please' }]),
            block('Shared-request', [{ text: 'A cabin on the flat, please' }]),
            block('BunkingNotes Notes', [{ text: 'Called the family Tuesday.' }], 'staff'),
          ],
        })}
      />
    )

    const rendered = screen.getAllByTestId('request-block')
    expect(rendered.map((el) => el.getAttribute('data-source-field'))).toEqual([
      'COVID-19 Bunking Requests',
      'Shared-request',
      'BunkingNotes Notes',
    ])
    expect(rendered.map((el) => el.getAttribute('data-authorship'))).toEqual([
      'family',
      'family',
      'staff',
    ])
  })

  it('leaves `Internal Bunk Notes` verbatim -- it already reads correctly', () => {
    // The sibling staff field was explicitly NOT relabelled while
    // `BunkingNotes Notes` beside it was.
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('Internal Bunk Notes', [{ text: 'Watch the cabin split here.' }], 'staff'),
          ],
        })}
      />
    )

    expect(screen.getByText('Internal Bunk Notes')).toBeInTheDocument()
  })

  it('leaves `Share Bunk With` verbatim -- the owner never named it', () => {
    // The third untouched field. It was not mentioned in either review pass,
    // and an unmentioned field is an unchanged field.
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [block('Share Bunk With', [{ text: 'Cabin with a fridge' }])],
        })}
      />
    )

    expect(screen.getByText('Share Bunk With')).toBeInTheDocument()
  })

  it('never joins two blocks into one run of text', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_text: 'first; second',
          request_blocks: [
            block('Shared-request', [{ text: 'first' }]),
            block('FAM CAMP-Share Comments', [{ text: 'second' }]),
          ],
        })}
      />
    )

    expect(screen.queryByText('first; second')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('request-entry')).toHaveLength(2)
  })
})

describe('per-child split', () => {
  it('sub-labels each answer with the child who wrote it', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('FAM CAMP-Share Comments', [
              { text: 'With Olivia Chen', contributors: ['Emma Johnson'] },
              { text: 'With Riley Sam', contributors: ['Liam Johnson'] },
            ]),
          ],
        })}
      />
    )

    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Liam Johnson')).toBeInTheDocument()
  })

  it('names every contributor when siblings wrote the same sentence', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('Shared-request', [
              {
                text: 'Please house us near a bathhouse',
                contributors: ['Emma Johnson', 'Liam Johnson'],
              },
            ]),
          ],
        })}
      />
    )

    expect(screen.getAllByTestId('request-entry')).toHaveLength(1)
    expect(screen.getByText('Emma Johnson, Liam Johnson')).toBeInTheDocument()
  })

  it('renders no sub-label at all when nobody is attributed', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('FAM CAMP-Share Comments', [{ text: 'A quiet corner', contributors: [] }]),
          ],
        })}
      />
    )

    expect(screen.getByText('A quiet corner')).toBeInTheDocument()
    expect(screen.queryByTestId('request-entry-contributors')).not.toBeInTheDocument()
  })
})

describe('expanded by default, collapsible by click', () => {
  it('shows every answer on first render without a click', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('FAM CAMP-Share Comments', [{ text: 'A quiet cabin, please' }]),
            // NOT `Internal Bunk Notes` -- the 2026-08-21 follow-up ruling
            // starts it folded, and this test asserts both entries render
            // without a click. `BunkingNotes Notes` is the other staff field
            // and keeps the old expanded-by-default.
            block('BunkingNotes Notes', [{ text: 'Called the family Tuesday.' }], 'staff'),
          ],
        })}
      />
    )

    expect(screen.getByText('A quiet cabin, please')).toBeInTheDocument()
    expect(screen.getByText('Called the family Tuesday.')).toBeInTheDocument()
  })

  it('folds one block away on click and leaves its neighbour open', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('COVID-19 Bunking Requests', [{ text: 'A quiet cabin, please' }]),
            block('BunkingNotes Notes', [{ text: 'Cabin with a fridge' }], 'staff'),
          ],
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Bunking Notes' }))

    expect(screen.getByText('A quiet cabin, please')).toBeInTheDocument()
    expect(screen.queryByText('Cabin with a fridge')).not.toBeInTheDocument()
    // The header itself stays, or there is nothing left to click to reopen.
    expect(screen.getByText('Bunking Notes')).toBeInTheDocument()
  })

  it('reopens a folded block on a second click', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [block('Shared-request', [{ text: 'A cabin on the flat, please' }])],
        })}
      />
    )
    const header = screen.getByRole('button', { name: 'Reg Form Bunk Notes' })

    fireEvent.click(header)
    expect(screen.queryByText('A cabin on the flat, please')).not.toBeInTheDocument()

    fireEvent.click(header)
    expect(screen.getByText('A cabin on the flat, please')).toBeInTheDocument()
  })
})

describe('Share Bunk With and Internal Bunk Notes start collapsed; their siblings do not (kindred#2476, staff ruling 2026-08-21)', () => {
  // Owner ruling 2026-08-21, tuning the 2026-08-17 "blocks start EXPANDED"
  // ruling: `Share Bunk With` starts folded (kindred#2476 / PR #2521). A
  // same-day follow-up staff ruling extends the identical treatment to
  // `Internal Bunk Notes` -- both source fields now start folded, and every
  // other block keeps the old default.
  it('renders Share Bunk With folded on first paint while a sibling stays open', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('FAM CAMP-Share Comments', [{ text: 'A quiet cabin, please' }]),
            block('Share Bunk With', [{ text: 'Cabin with a fridge' }]),
          ],
        })}
      />
    )

    expect(screen.getByText('A quiet cabin, please')).toBeInTheDocument()
    expect(screen.queryByText('Cabin with a fridge')).not.toBeInTheDocument()
    // The header stays, or there is nothing left to click to open it.
    expect(screen.getByText('Share Bunk With')).toBeInTheDocument()
  })

  it('opens Share Bunk With on click, same as any other block', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [block('Share Bunk With', [{ text: 'Cabin with a fridge' }])],
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Share Bunk With' }))
    expect(screen.getByText('Cabin with a fridge')).toBeInTheDocument()
  })

  it('opens on a click that lands on the chevron glyph itself, not just the label', () => {
    // Regression pin: the chevron used to sit OUTSIDE the <button> with no
    // handler of its own, as did the Staff tag — staff clicking the ▸ glyph
    // on a collapsed row saw nothing happen; only the label text worked.
    // Query the chevron by its lucide class rather than by role/name, so
    // this fails again if the chevron ever drifts back outside the row's
    // click target.
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [block('Share Bunk With', [{ text: 'Cabin with a fridge' }])],
        })}
      />
    )

    const chevron = screen.getByTestId('request-block').querySelector('.lucide-chevron-right')
    expect(chevron).not.toBeNull()
    fireEvent.click(chevron as Element)

    expect(screen.getByText('Cabin with a fridge')).toBeInTheDocument()
  })

  it('THE TRAP: a household switch re-collapses Share Bunk With rather than opening it', () => {
    // Applying the collapsed default only to the initial `useState` seed is
    // not enough -- the reset-on-household-change branch re-seeds `folded`
    // too (the panel is never remounted between families; see the comment
    // on that branch), and a bare `new Set()` there would open Share Bunk
    // With for every household after the first, the moment staff click the
    // next family.
    const first = party({
      request_blocks: [block('Share Bunk With', [{ text: "The first family's fridge ask" }])],
    })
    const second = party({
      request_blocks: [block('Share Bunk With', [{ text: "The second family's fridge ask" }])],
    })

    const { rerender } = render(<ShareRequestPanel party={first} />)
    expect(screen.queryByText("The first family's fridge ask")).not.toBeInTheDocument()

    rerender(<ShareRequestPanel party={second} />)

    expect(screen.queryByText("The second family's fridge ask")).not.toBeInTheDocument()
  })

  it('renders Internal Bunk Notes folded on first paint while a sibling stays open', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('FAM CAMP-Share Comments', [{ text: 'A quiet cabin, please' }]),
            block('Internal Bunk Notes', [{ text: 'Watch the cabin split here.' }], 'staff'),
          ],
        })}
      />
    )

    expect(screen.getByText('A quiet cabin, please')).toBeInTheDocument()
    expect(screen.queryByText('Watch the cabin split here.')).not.toBeInTheDocument()
    // The header stays, or there is nothing left to click to open it.
    expect(screen.getByText('Internal Bunk Notes')).toBeInTheDocument()
  })

  it('opens Internal Bunk Notes on click, same as any other block', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('Internal Bunk Notes', [{ text: 'Watch the cabin split here.' }], 'staff'),
          ],
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Internal Bunk Notes' }))
    expect(screen.getByText('Watch the cabin split here.')).toBeInTheDocument()
  })

  it('THE TRAP: a household switch re-collapses Internal Bunk Notes rather than opening it', () => {
    // Same trap as Share Bunk With above, pinned separately: the default has
    // to be applied in the reset-on-household-change branch too, or Internal
    // Bunk Notes re-opens for every household after the first, the moment
    // staff click the next family.
    const first = party({
      request_blocks: [
        block('Internal Bunk Notes', [{ text: "The first family's cabin-split note" }], 'staff'),
      ],
    })
    const second = party({
      request_blocks: [
        block('Internal Bunk Notes', [{ text: "The second family's cabin-split note" }], 'staff'),
      ],
    })

    const { rerender } = render(<ShareRequestPanel party={first} />)
    expect(screen.queryByText("The first family's cabin-split note")).not.toBeInTheDocument()

    rerender(<ShareRequestPanel party={second} />)

    expect(screen.queryByText("The second family's cabin-split note")).not.toBeInTheDocument()
  })
})

describe('one treatment, and the lane is data rather than colour', () => {
  it('renders a family-authored answer as plain, indented, italic text -- no rail', () => {
    // The amber blockquote is GONE from this section (owner ruling,
    // supersedes the "inherited amber blockquote" reasoning this test used
    // to pin) -- every text renders in the mockup's plain `.mksay` style
    // instead. `COVID-19 Bunking Requests` is an ordinary block here, but the
    // TEXT TREATMENT is the same wherever it renders in this section.
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [block('COVID-19 Bunking Requests', [{ text: 'A quiet cabin, please' }])],
        })}
      />
    )

    const entry = screen.getByTestId('request-entry')
    expect(entry.className).not.toContain('amber')
    expect(entry.className).not.toContain('border-l-2')
    expect(entry.className).toContain('italic')
    expect(entry.textContent).toBe('A quiet cabin, please')
  })

  it('renders the two staff-authored fields in that SAME plain style', () => {
    // Owner review 2026-08-17, after seeing the panel live: the shipped
    // design gave these two a grey rail so an internal note could not read
    // as a family's own ask; the amber rail that replaced it is now gone
    // too. What survives across every rework is that staff- and
    // family-authored text render IDENTICALLY -- `authorship` still decides
    // whether these blocks reach the client at all (`_may_read_staff_notes`),
    // which the next test pins.
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('BunkingNotes Notes', [{ text: 'Called the family Tuesday.' }], 'staff'),
            block('Internal Bunk Notes', [{ text: 'Watch the cabin split here.' }], 'staff'),
          ],
        })}
      />
    )
    // Internal Bunk Notes starts folded (2026-08-21 staff ruling) -- open it
    // explicitly so both staff-authored entries are on screen for this check,
    // same as BunkingNotes Notes which still starts expanded.
    fireEvent.click(screen.getByRole('button', { name: 'Internal Bunk Notes' }))

    for (const entry of screen.getAllByTestId('request-entry')) {
      expect(entry.className).not.toContain('amber')
      expect(entry.className).toContain('italic')
    }
  })

  it('marks which lane a block belongs to on the block itself', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('Shared-request', [{ text: 'A cabin on the flat, please' }]),
            block('Internal Bunk Notes', [{ text: 'Watch the cabin split here.' }], 'staff'),
          ],
        })}
      />
    )

    expect(
      screen.getAllByTestId('request-block').map((el) => el.getAttribute('data-authorship'))
    ).toEqual(['family', 'staff'])
  })
})

describe('no amber rail survives anywhere in this section (owner ruling, mockup 2026-08-27)', () => {
  it('renders every free-text block with no amber/rail class', () => {
    // Rows 1-2 (the anchor/cluster choice rows) carry NO text at all any
    // more (owner ruling 2026-08-27), so this fixture is every FREE-TEXT
    // source field instead -- the only place `request-entry` elements exist.
    const { container } = render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('Shared-request', [{ text: 'reg form text' }]),
            block('COVID-19 Bunking Requests', [{ text: 'fam info form text' }]),
            block('BunkingNotes Notes', [{ text: 'a note row' }], 'staff'),
            block('FAM CAMP-Share Comments', [{ text: 'a plain block' }]),
          ],
        })}
      />
    )

    for (const entry of screen.getAllByTestId('request-entry')) {
      expect(entry.className).not.toMatch(/amber/)
      expect(entry.className).not.toMatch(/border-l-2/)
    }
    // Belt and braces: no element anywhere in the rendered tree carries the
    // deleted `REQUEST_RAIL` string's signature classes.
    expect(container.querySelectorAll('[class*="amber"]')).toHaveLength(0)
    expect(container.querySelectorAll('[class*="border-l-2"]')).toHaveLength(0)
  })
})

describe('an empty source field renders nothing at all', () => {
  it('renders no blocks and no placeholder for a household with no text', () => {
    render(<ShareRequestPanel party={party()} />)

    expect(screen.queryAllByTestId('request-block')).toHaveLength(0)
    expect(screen.queryByText(/nothing applicable/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/none/i)).not.toBeInTheDocument()
  })

  it('drops a block whose entries are all blank rather than drawing an empty rail', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('Shared-request', [{ text: '   ' }]),
            block('Share Bunk With', [{ text: 'Cabin with a fridge' }]),
          ],
        })}
      />
    )

    expect(
      screen.getAllByTestId('request-block').map((el) => el.getAttribute('data-source-field'))
    ).toEqual(['Share Bunk With'])
  })

  it('renders no `Reg Form Bunk Notes` row at all for a household with no `Shared-request` text', () => {
    // Confirmed, not assumed (owner instruction 2026-08-27): deleting the
    // `show*Text` flags that used to enforce this for the two paired fields
    // must not have opened a gap. `withText` already drops any block whose
    // entries are all blank BEFORE the fold loop sees it, and that filter
    // applies uniformly to all six source fields now -- so a household with
    // no `Shared-request` text (omitted entirely, as here) gets no row for
    // it, not an empty one with a label and nothing beneath.
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [block('Share Bunk With', [{ text: 'Cabin with a fridge' }])],
        })}
      />
    )

    expect(screen.queryByText('Reg Form Bunk Notes')).not.toBeInTheDocument()
    expect(screen.queryByText('Fam Info Form Bunk Notes')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('request-block')).toHaveLength(1)
  })
})

describe('the heaviest real household still fits a 416px panel', () => {
  const LONG_ANSWER = 'We would really like a cabin near the bathhouse. '.repeat(23)

  it('renders a 1,100-character answer whole, wrapping inside the panel', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [block('COVID-19 Bunking Requests', [{ text: LONG_ANSWER }])],
        })}
      />
    )

    const entry = screen.getByTestId('request-entry')
    expect(entry.textContent).toBe(LONG_ANSWER)
    // `whitespace-pre-wrap` keeps the family's own line breaks; `break-words`
    // is what stops a long unbroken token (an email address, a URL) pushing
    // the 416px panel into a horizontal scroll.
    expect(entry.className).toContain('whitespace-pre-wrap')
    expect(entry.className).toContain('break-words')
  })

  it('renders four blocks and seven entries without collapsing any of them', () => {
    // The measured worst case: 9 households render four source fields, and
    // one renders seven distinct answers across them. `Share Bunk With` and
    // `Internal Bunk Notes` are opened explicitly since both start folded
    // (kindred#2476 / 2026-08-21).
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('FAM CAMP-Share Comments', [
              { text: 'one', contributors: ['Emma Johnson'] },
              { text: 'two', contributors: ['Liam Johnson'] },
            ]),
            block('BunkingNotes Notes', [{ text: 'three' }, { text: 'four' }], 'staff'),
            block('Share Bunk With', [{ text: 'five', contributors: ['Emma Johnson'] }]),
            block('Internal Bunk Notes', [{ text: 'six' }, { text: 'seven' }], 'staff'),
          ],
        })}
      />
    )

    expect(screen.getAllByTestId('request-block')).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: 'Share Bunk With' }))
    fireEvent.click(screen.getByRole('button', { name: 'Internal Bunk Notes' }))

    expect(screen.getAllByTestId('request-entry')).toHaveLength(7)
  })
})

describe('the joined column is still honoured when no blocks arrive', () => {
  it('falls back to the pre-split joined text rather than dropping it', () => {
    // Renamed from "...pre-split blockquote..." -- the amber "quoted"
    // blockquote rail was deleted from this whole section (owner ruling
    // 2026-08-27, mockup rework); the fallback still renders, just as plain
    // `.mksay` text like every other row, not a blockquote.
    // A payload with text but no blocks means the two raw lanes disagreed
    // with the derived column — a state production should not reach, and one
    // where losing a family's ask is far worse than losing its provenance.
    render(
      <ShareRequestPanel
        party={party({ request_text: 'Near the Garcia family', request_blocks: [] })}
      />
    )

    expect(screen.getByTestId('request-entry').textContent).toContain('Near the Garcia family')
    expect(screen.queryAllByTestId('request-block')).toHaveLength(0)
  })
})

describe('a fold belongs to the household it was made on', () => {
  // The panel is NOT remounted when staff click a different family: all three
  // callsites render `<FamilyDetailsPanel party={panelParty} …>` with no
  // `key`, and `usePanelParty` only swaps `selectedKey`, so the same
  // `ShareRequestPanel` instance receives the next household's `party`.
  // Keying a block on its source field alone therefore carried the fold
  // across -- `COVID-19 Bunking Requests` is the field this exact bug was
  // found on (205 of 382 rostered households share it), and it is an
  // ordinary fold-loop block again (owner ruling 2026-08-27), so this test
  // uses the real field once more.
  it('reopens a folded source field when the next household is shown', () => {
    const first = party({
      request_blocks: [block('COVID-19 Bunking Requests', [{ text: "The first family's ask" }])],
    })
    const second = party({
      request_blocks: [block('COVID-19 Bunking Requests', [{ text: "The second family's ask" }])],
    })

    const { rerender } = render(<ShareRequestPanel party={first} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fam Info Form Bunk Notes' }))
    expect(screen.queryByText("The first family's ask")).not.toBeInTheDocument()

    rerender(<ShareRequestPanel party={second} />)

    expect(screen.getByText("The second family's ask")).toBeInTheDocument()
  })

  it('keeps a fold while the same household is re-rendered', () => {
    // The reset is keyed on the `share` object, which `usePanelParty` memoises
    // per party — so a parent re-render (a pan, a hover, a drag) must not
    // silently unfold what staff just folded.
    const only = party({
      request_blocks: [block('Shared-request', [{ text: 'A cabin on the flat, please' }])],
    })

    const { rerender } = render(<ShareRequestPanel party={only} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reg Form Bunk Notes' }))
    rerender(<ShareRequestPanel party={only} />)

    expect(screen.queryByText('A cabin on the flat, please')).not.toBeInTheDocument()
  })
})

describe('the three CSV-lane notes render in the mark-row shape (kindred, spec 2026-08-27 §6)', () => {
  it('keeps the shipped fold defaults on the CSV notes', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            {
              source_field: 'BunkingNotes Notes',
              authorship: 'staff',
              entries: [{ text: 'open by default', contributors: [] }],
            },
            {
              source_field: 'Internal Bunk Notes',
              authorship: 'staff',
              entries: [{ text: 'closed by default', contributors: [] }],
            },
            {
              source_field: 'Share Bunk With',
              authorship: 'family',
              entries: [{ text: 'also closed', contributors: [] }],
            },
          ],
        })}
      />
    )
    expect(screen.getByText('open by default')).toBeInTheDocument()
    expect(screen.queryByText('closed by default')).not.toBeInTheDocument()
    expect(screen.queryByText('also closed')).not.toBeInTheDocument()
  })

  it('gives each of the three its own row icon: Tent, Lock, BedDouble', () => {
    // `svg.length > 0` pinned nothing -- every row also carries a chevron
    // svg, so deleting the entire `ROW_ICON` map would still leave this
    // green. lucide-react's `createLucideIcon` emits a stable
    // `lucide-<kebab-name>` class per icon (on top of the generic `lucide`
    // class), so query THAT, per row, and assert both the right icon is
    // there and the other two aren't.
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('BunkingNotes Notes', [{ text: 'a' }], 'staff'),
            block('Internal Bunk Notes', [{ text: 'b' }], 'staff'),
            block('Share Bunk With', [{ text: 'c' }]),
          ],
        })}
      />
    )
    const [bunking, internal, shareWith] = screen.getAllByTestId('request-block')

    expect(bunking?.querySelector('.lucide-tent')).not.toBeNull()
    expect(bunking?.querySelector('.lucide-lock')).toBeNull()
    expect(bunking?.querySelector('.lucide-bed-double')).toBeNull()

    expect(internal?.querySelector('.lucide-lock')).not.toBeNull()
    expect(internal?.querySelector('.lucide-tent')).toBeNull()
    expect(internal?.querySelector('.lucide-bed-double')).toBeNull()

    expect(shareWith?.querySelector('.lucide-bed-double')).not.toBeNull()
    expect(shareWith?.querySelector('.lucide-tent')).toBeNull()
    expect(shareWith?.querySelector('.lucide-lock')).toBeNull()
  })
})

describe('a paired source field is not also rendered by the joined fallback', () => {
  // REGRESSION (c39c5599), found by the owner on a real 2026 household whose
  // only request text sat in `COVID-19 Bunking Requests`. At the time, that
  // field was lifted OUT of the block list to pair its text under row 2 --
  // an architecture owner ruling 2026-08-27 (this same day, a later session)
  // reverted outright: `Shared-request` and `COVID-19 Bunking Requests` are
  // ordinary blocks again, flowing through the SAME `blocks` list the
  // pre-split `request_text` fallback also reads. With one list instead of
  // two, the ORIGINAL bug (an unfiltered list disagreeing with a filtered
  // one about whether any text arrived) cannot recur by construction -- but
  // the invariant it protects is still worth pinning by name: a source field
  // renders exactly once, and the joined fallback fires only when NO blocks
  // arrive at all. Re-pointed at the new structure per instruction, not
  // deleted.
  const ONE_ASK = 'A cabin near the dining hall would help us a great deal.'

  it('renders `COVID-19 Bunking Requests` once, never doubled by the joined fallback', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_text: ONE_ASK,
          request_blocks: [block('COVID-19 Bunking Requests', [{ text: ONE_ASK }])],
        })}
      />
    )
    expect(screen.queryAllByText(ONE_ASK)).toHaveLength(1)
  })

  it('renders `Shared-request` once, never doubled by the joined fallback', () => {
    render(
      <ShareRequestPanel
        party={party({
          request_text: ONE_ASK,
          request_blocks: [block('Shared-request', [{ text: ONE_ASK }])],
        })}
      />
    )
    expect(screen.queryAllByText(ONE_ASK)).toHaveLength(1)
  })

  it('still falls back to the joined column when NO blocks arrive at all', () => {
    // The fallback's real purpose survives: losing a family's ask is worse
    // than losing its provenance.
    render(<ShareRequestPanel party={party({ request_text: ONE_ASK, request_blocks: [] })} />)
    expect(screen.queryAllByText(ONE_ASK)).toHaveLength(1)
  })

  it('reports its fold state on the button, and the state tracks the click', () => {
    // `aria-expanded` is the disclosure state the mockup's own `.mkbtn`
    // carries and the spelling this repo already uses for a fold. Asserted
    // through the accessible role rather than a class, so it also proves the
    // whole row — not just the label — is one control.
    render(
      <ShareRequestPanel
        party={party({
          request_blocks: [
            block('BunkingNotes Notes', [{ text: 'Open by default' }], 'staff'),
            block('Internal Bunk Notes', [{ text: 'Closed by default' }], 'staff'),
          ],
        })}
      />
    )
    const open = screen.getByRole('button', { name: /Bunking Notes/ })
    const closed = screen.getByRole('button', { name: /Internal Bunk Notes/ })
    expect(open).toHaveAttribute('aria-expanded', 'true')
    expect(closed).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(closed)
    expect(screen.getByRole('button', { name: /Internal Bunk Notes/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })
})
