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
 * member facing the seven-entry household can fold them away).
 *
 * Shape it is built against, measured on the 2026 production snapshot over
 * the 382 households rostered into a family session: 270 carry any text, 142
 * of them in one source field, 90 in two, 29 in three and 9 in four; the
 * heaviest household renders seven entries across those blocks and 1,109
 * characters, in a 416px panel.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { RequestTextBlockRow, ShareRequest } from '../../types/lodging'
import { ShareRequestPanel } from './ShareRequestPanel'

function share(overrides: Partial<ShareRequest> = {}): ShareRequest {
  return {
    preference: 'unknown',
    preference_raw: '',
    proximity: [],
    request_text: '',
    needs_resolution: false,
    request_blocks: [],
    ...overrides,
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

describe('SharePreferenceChip inside ShareRequestPanel', () => {
  it('renders a hard no as "Will not share"', () => {
    render(<ShareRequestPanel share={share({ preference: 'no_share' })} />)
    expect(screen.getByText('Will not share')).toBeInTheDocument()
  })

  it('renders the maybe answer as mutual-only', () => {
    render(<ShareRequestPanel share={share({ preference: 'maybe_mutual' })} />)
    expect(screen.getByText('Only if mutual')).toBeInTheDocument()
  })

  it('renders the yes answer as open to sharing', () => {
    render(<ShareRequestPanel share={share({ preference: 'yes_share' })} />)
    expect(screen.getByText('Open to sharing')).toBeInTheDocument()
  })

  it('renders an unanswered preference as "Not answered", not as consent', () => {
    render(<ShareRequestPanel share={share({ preference: 'unknown' })} />)
    expect(screen.getByText('Not answered')).toBeInTheDocument()
    expect(screen.queryByText('Open to sharing')).not.toBeInTheDocument()
  })

  it('shows the verbatim CampMinder answer in a tooltip keyboard and touch can reach', () => {
    // kindred#2177: this was a bare `title`, which fires on mouse hover and
    // nothing else — staff on a tablet saw the chip and never the answer.
    render(
      <ShareRequestPanel
        share={share({ preference: 'no_share', preference_raw: 'No, prefer not to share' })}
      />
    )
    const chip = screen.getByRole('button', { name: 'Will not share' })
    expect(chip).not.toHaveAttribute('title')
    fireEvent.focus(chip)
    expect(screen.getByRole('tooltip')).toHaveTextContent('No, prefer not to share')
  })

  it('leaves a chip with nothing to explain as plain text, not a dead tab stop', () => {
    // An unanswered preference has no verbatim answer behind it. Making every
    // chip focusable would put a stop in the tab order that reveals nothing —
    // the same argument `MapUnitPopover` makes about its empty cells.
    render(<ShareRequestPanel share={share({ preference: 'unknown', preference_raw: '' })} />)
    expect(screen.getByText('Not answered')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Not answered' })).not.toBeInTheDocument()
  })

  it('treats a whitespace-only answer as no answer at all', () => {
    // A blank-but-not-empty CampMinder cell would otherwise pass the length
    // check and mint a focusable chip whose bubble renders nothing.
    render(<ShareRequestPanel share={share({ preference: 'no_share', preference_raw: '  ' })} />)
    expect(screen.queryByRole('button', { name: 'Will not share' })).not.toBeInTheDocument()
  })
})

describe('proximity kinds', () => {
  it('labels NEAR as proximity, not co-housing', () => {
    render(<ShareRequestPanel share={share({ proximity: ['near'] })} />)
    expect(screen.getByText('Near another family')).toBeInTheDocument()
    expect(screen.queryByText('Same cabin as another family')).not.toBeInTheDocument()
  })

  it('labels WITH as co-housing', () => {
    render(<ShareRequestPanel share={share({ proximity: ['with'] })} />)
    expect(screen.getByText('Same cabin as another family')).toBeInTheDocument()
  })

  it('renders both when the multi-select carried both', () => {
    render(<ShareRequestPanel share={share({ proximity: ['near', 'with'] })} />)
    expect(screen.getByText('Near another family')).toBeInTheDocument()
    expect(screen.getByText('Same cabin as another family')).toBeInTheDocument()
  })

  it('labels the similarly-aged option distinctly', () => {
    render(<ShareRequestPanel share={share({ proximity: ['similar_ages'] })} />)
    expect(screen.getByText('With similarly-aged kids')).toBeInTheDocument()
  })

  it('renders similar_ages ALONGSIDE with, never instead of it', () => {
    // similar_ages always accompanies `with` on the wire — the option it comes
    // from begins "Share a cabin WITH", and what differs is only that the
    // partner is unnamed. Dropping the WITH chip would drop these households
    // out of any "wants to share a cabin" view.
    render(<ShareRequestPanel share={share({ proximity: ['with', 'similar_ages'] })} />)
    expect(screen.getByText('Same cabin as another family')).toBeInTheDocument()
    expect(screen.getByText('With similarly-aged kids')).toBeInTheDocument()
  })
})

describe('raw request text', () => {
  it('shows the verbatim text with a needs-resolution badge', () => {
    render(
      <ShareRequestPanel
        share={share({
          request_text: 'Please house us near the Garcia family',
          needs_resolution: true,
        })}
      />
    )
    expect(screen.getByText(/Please house us near the Garcia family/)).toBeInTheDocument()
    expect(screen.getByText('Needs resolution')).toBeInTheDocument()
  })

  it('renders a joined request with no blocks as ONE verbatim block', () => {
    // The FALLBACK path since kindred#2330. `request_text` really is an
    // irreversible join, so a payload carrying it with no blocks beside it
    // still renders exactly as sent — losing a family's ask would be worse
    // than losing its provenance. Splitting this string client-side is what
    // remains impossible.
    const joined = 'Near the Garcia family; we have a toddler; ground floor please'
    render(<ShareRequestPanel share={share({ request_text: joined, needs_resolution: true })} />)
    expect(
      screen.getByText(new RegExp(joined.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    ).toBeInTheDocument()
  })

  it('shows nothing to resolve when there is no free text', () => {
    render(<ShareRequestPanel share={share()} />)
    expect(screen.queryByText('Needs resolution')).not.toBeInTheDocument()
  })
})

describe('per-field split', () => {
  it('renders one labelled block per source field', () => {
    render(
      <ShareRequestPanel
        share={share({
          request_text: 'Near the Garcia family; Cabin with a fridge',
          request_blocks: [
            block('COVID-19 Bunking Requests', [{ text: 'Near the Garcia family' }]),
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

  it('labels a block with the ORIGINAL CampMinder field name, verbatim', () => {
    // Owner ruling 2026-08-17: "call them the original fieldnames for now
    // until staff can weigh in after it's live". `COVID-19 Bunking Requests`
    // is the misnamed field carrying 205 rostered households of general
    // bunking requests, and it renders under that name on purpose. The owner
    // has since weighed in on exactly ONE label -- `BunkingNotes Notes`, below
    // -- and on no other. This one is still verbatim, deliberately.
    render(
      <ShareRequestPanel
        share={share({
          request_blocks: [block('COVID-19 Bunking Requests', [{ text: 'A quiet cabin, please' }])],
        })}
      />
    )

    expect(screen.getByText('COVID-19 Bunking Requests')).toBeInTheDocument()
  })

  it('renders the one relabelled field as `Bunking Notes`', () => {
    // Owner review 2026-08-17, after seeing the panel live: `BunkingNotes
    // Notes` reads as a typo and gets a DISPLAY name. It is the only one.
    render(
      <ShareRequestPanel
        share={share({
          request_blocks: [
            block('BunkingNotes Notes', [{ text: 'Called the family Tuesday.' }], 'staff'),
          ],
        })}
      />
    )

    expect(screen.getByText('Bunking Notes')).toBeInTheDocument()
    expect(screen.queryByText('BunkingNotes Notes')).not.toBeInTheDocument()
  })

  it('relabels the DISPLAY only, and leaves the source-field identity alone', () => {
    // `BunkingNotes Notes` is the CampMinder field name. `REQUEST_TEXT_SOURCES`
    // keys the authorship lane on it, `_may_read_staff_notes` gates on the
    // table it comes from, and the Go ingest maps it to the `bunking_notes`
    // slug. A display map that renamed the identity would be a data change
    // wearing a label change's clothes.
    render(
      <ShareRequestPanel
        share={share({
          request_blocks: [
            block('BunkingNotes Notes', [{ text: 'Called the family Tuesday.' }], 'staff'),
          ],
        })}
      />
    )

    const rendered = screen.getByTestId('request-block')
    expect(rendered.getAttribute('data-source-field')).toBe('BunkingNotes Notes')
    expect(rendered.getAttribute('data-authorship')).toBe('staff')
  })

  it('leaves `Internal Bunk Notes` verbatim -- it already reads correctly', () => {
    // The sibling staff field was explicitly NOT relabelled. One label moved,
    // and only one.
    render(
      <ShareRequestPanel
        share={share({
          request_blocks: [
            block('Internal Bunk Notes', [{ text: 'Watch the cabin split here.' }], 'staff'),
          ],
        })}
      />
    )

    expect(screen.getByText('Internal Bunk Notes')).toBeInTheDocument()
  })

  it('never joins two blocks into one run of text', () => {
    render(
      <ShareRequestPanel
        share={share({
          request_text: 'first; second',
          request_blocks: [
            block('Shared-request', [{ text: 'first' }]),
            block('Share Bunk With', [{ text: 'second' }]),
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
        share={share({
          request_blocks: [
            block('Share Bunk With', [
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
        share={share({
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
        share={share({
          request_blocks: [block('Shared-request', [{ text: 'A quiet corner', contributors: [] }])],
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
        share={share({
          request_blocks: [
            block('COVID-19 Bunking Requests', [{ text: 'A quiet cabin, please' }]),
            block('Internal Bunk Notes', [{ text: 'Called the family Tuesday.' }], 'staff'),
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
        share={share({
          request_blocks: [
            block('COVID-19 Bunking Requests', [{ text: 'A quiet cabin, please' }]),
            block('Share Bunk With', [{ text: 'Cabin with a fridge' }]),
          ],
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /COVID-19 Bunking Requests/ }))

    expect(screen.queryByText('A quiet cabin, please')).not.toBeInTheDocument()
    expect(screen.getByText('Cabin with a fridge')).toBeInTheDocument()
    // The header itself stays, or there is nothing left to click to reopen.
    expect(screen.getByText('COVID-19 Bunking Requests')).toBeInTheDocument()
  })

  it('reopens a folded block on a second click', () => {
    render(
      <ShareRequestPanel
        share={share({
          request_blocks: [block('Shared-request', [{ text: 'A cabin on the flat, please' }])],
        })}
      />
    )
    const header = screen.getByRole('button', { name: /Shared-request/ })

    fireEvent.click(header)
    expect(screen.queryByText('A cabin on the flat, please')).not.toBeInTheDocument()

    fireEvent.click(header)
    expect(screen.getByText('A cabin on the flat, please')).toBeInTheDocument()
  })
})

describe('one treatment, and the lane is data rather than colour', () => {
  it('renders a family-authored answer in the inherited amber blockquote', () => {
    // The SAME amber blockquote the camper details panel uses for parent
    // request text, so a request reads the same wherever staff meet one.
    render(
      <ShareRequestPanel
        share={share({
          request_blocks: [block('COVID-19 Bunking Requests', [{ text: 'A quiet cabin, please' }])],
        })}
      />
    )

    const entry = screen.getByTestId('request-entry')
    expect(entry.className).toContain('border-amber-300')
    expect(entry.className).toContain('bg-amber-50/60')
  })

  it('renders the two staff-authored fields on that SAME amber rail', () => {
    // Owner review 2026-08-17, after seeing the panel live: the shipped design
    // gave these two a grey rail so an internal note could not read as a
    // family's own ask. Standardise on amber for now instead. What is dropped
    // is the COLOUR, not the distinction -- `authorship` still decides whether
    // these blocks reach the client at all (`_may_read_staff_notes`), which
    // the next test pins.
    render(
      <ShareRequestPanel
        share={share({
          request_blocks: [
            block('BunkingNotes Notes', [{ text: 'Called the family Tuesday.' }], 'staff'),
            block('Internal Bunk Notes', [{ text: 'Watch the cabin split here.' }], 'staff'),
          ],
        })}
      />
    )

    for (const entry of screen.getAllByTestId('request-entry')) {
      expect(entry.className).toContain('border-amber-300')
      expect(entry.className).toContain('bg-amber-50/60')
      expect(entry.className).not.toContain('border-border')
      expect(entry.className).not.toContain('bg-muted')
    }
  })

  it('marks which lane a block belongs to on the block itself', () => {
    render(
      <ShareRequestPanel
        share={share({
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

describe('an empty source field renders nothing at all', () => {
  it('renders no blocks and no placeholder for a household with no text', () => {
    render(<ShareRequestPanel share={share()} />)

    expect(screen.queryAllByTestId('request-block')).toHaveLength(0)
    expect(screen.queryByText(/nothing applicable/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/none/i)).not.toBeInTheDocument()
  })

  it('drops a block whose entries are all blank rather than drawing an empty rail', () => {
    render(
      <ShareRequestPanel
        share={share({
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
})

describe('the heaviest real household still fits a 416px panel', () => {
  const LONG_ANSWER = 'We would really like a cabin near the bathhouse. '.repeat(23)

  it('renders a 1,100-character answer whole, wrapping inside the panel', () => {
    render(
      <ShareRequestPanel
        share={share({
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
    // one renders seven distinct answers across them.
    render(
      <ShareRequestPanel
        share={share({
          request_blocks: [
            block('COVID-19 Bunking Requests', [
              { text: 'one', contributors: ['Emma Johnson'] },
              { text: 'two', contributors: ['Liam Johnson'] },
            ]),
            block('Share Bunk With', [
              { text: 'three', contributors: ['Emma Johnson'] },
              { text: 'four', contributors: ['Liam Johnson'] },
            ]),
            block('Shared-request', [{ text: 'five', contributors: ['Emma Johnson'] }]),
            block('BunkingNotes Notes', [{ text: 'six' }, { text: 'seven' }], 'staff'),
          ],
        })}
      />
    )

    expect(screen.getAllByTestId('request-block')).toHaveLength(4)
    expect(screen.getAllByTestId('request-entry')).toHaveLength(7)
  })
})

describe('the joined column is still honoured when no blocks arrive', () => {
  it('falls back to the pre-split blockquote rather than dropping the text', () => {
    // A payload with text but no blocks means the two raw lanes disagreed
    // with the derived column — a state production should not reach, and one
    // where losing a family's ask is far worse than losing its provenance.
    render(
      <ShareRequestPanel
        share={share({ request_text: 'Near the Garcia family', request_blocks: [] })}
      />
    )

    expect(screen.getByTestId('request-entry').textContent).toContain('Near the Garcia family')
    expect(screen.queryAllByTestId('request-block')).toHaveLength(0)
  })

  it('shows the needs-resolution marker once, not once per block', () => {
    render(
      <ShareRequestPanel
        share={share({
          needs_resolution: true,
          request_text: 'Near the Garcia family; Cabin with a fridge',
          request_blocks: [
            block('COVID-19 Bunking Requests', [{ text: 'Near the Garcia family' }]),
            block('Share Bunk With', [{ text: 'Cabin with a fridge' }]),
          ],
        })}
      />
    )

    expect(screen.getAllByText('Needs resolution')).toHaveLength(1)
  })
})

describe('a fold belongs to the household it was made on', () => {
  // The panel is NOT remounted when staff click a different family: all three
  // callsites render `<FamilyDetailsPanel party={panelParty} …>` with no
  // `key`, and `usePanelParty` only swaps `selectedKey`, so the same
  // `ShareRequestPanel` instance receives the next household's `share`.
  // Keying a block on its source field alone therefore carried the fold
  // across — and every household shares `COVID-19 Bunking Requests` with 204
  // others, so the second family's request text arrived already hidden. That
  // is the exact failure the "blocks start expanded" ruling exists to
  // prevent.
  it('reopens a folded source field when the next household is shown', () => {
    const first = share({
      request_blocks: [block('COVID-19 Bunking Requests', [{ text: "The first family's ask" }])],
    })
    const second = share({
      request_blocks: [block('COVID-19 Bunking Requests', [{ text: "The second family's ask" }])],
    })

    const { rerender } = render(<ShareRequestPanel share={first} />)
    fireEvent.click(screen.getByRole('button', { name: /COVID-19 Bunking Requests/ }))
    expect(screen.queryByText("The first family's ask")).not.toBeInTheDocument()

    rerender(<ShareRequestPanel share={second} />)

    expect(screen.getByText("The second family's ask")).toBeInTheDocument()
  })

  it('keeps a fold while the same household is re-rendered', () => {
    // The reset is keyed on the `share` object, which `usePanelParty` memoises
    // per party — so a parent re-render (a pan, a hover, a drag) must not
    // silently unfold what staff just folded.
    const only = share({
      request_blocks: [block('Shared-request', [{ text: 'A cabin on the flat, please' }])],
    })

    const { rerender } = render(<ShareRequestPanel share={only} />)
    fireEvent.click(screen.getByRole('button', { name: /Shared-request/ }))
    rerender(<ShareRequestPanel share={only} />)

    expect(screen.queryByText('A cabin on the flat, please')).not.toBeInTheDocument()
  })
})
