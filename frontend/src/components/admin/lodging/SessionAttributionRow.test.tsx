/**
 * One row of the cabin-weekend attribution queue. Shared by the admin queue
 * tab and the board's modal (kindred#2648 UI half) — see
 * `useSessionAttributionQueue`'s module doc for why it is one component.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { SessionAttributionQueueItem } from '../../../hooks/useSessionAttributionQueue'
import { EVIDENCE_LINE } from './attributionEvidence'
import { SessionAttributionRow } from './SessionAttributionRow'

function itemFixture(over: Partial<SessionAttributionQueueItem> = {}): SessionAttributionQueueItem {
  return {
    id: 'q1',
    rawValue: 'Willow 1',
    sourceField: 'Family Camp Cabin',
    householdCmId: 2000001,
    personCmId: 0,
    occurrences: 3,
    firstSeen: '2026-08-18 00:00:00.000Z',
    lastSeen: '2026-08-23 00:00:00.000Z',
    resolvedUnitNames: ['Willow 1'],
    candidates: [
      {
        sessionCmId: 1309515,
        short: 'Family Camp 2',
        dateRange: 'Aug 20–23, 2026',
        isSuggested: true,
      },
      {
        sessionCmId: 1309519,
        short: 'Family Camp 6',
        dateRange: 'Sep 24–27, 2026',
        isSuggested: false,
      },
    ],
    isStale: false,
    ...over,
  }
}

describe('SessionAttributionRow', () => {
  it('shows the raw CampMinder value and the household it belongs to', () => {
    // The fixture's raw value and its resolved unit happen to be the same
    // string ("Willow 1" is an exact-match alias for itself) — a realistic
    // case, so this asserts BOTH render rather than picking one arbitrarily.
    render(<SessionAttributionRow item={itemFixture()} onConfirm={vi.fn()} isConfirming={false} />)
    expect(screen.getAllByText('Willow 1')).toHaveLength(2)
    expect(screen.getByText(/2000001/)).toBeInTheDocument()
  })

  it('shows the person id instead when the row is person-scoped', () => {
    render(
      <SessionAttributionRow
        item={itemFixture({ householdCmId: 0, personCmId: 3100001 })}
        onConfirm={vi.fn()}
        isConfirming={false}
      />
    )
    expect(screen.getByText(/3100001/)).toBeInTheDocument()
  })

  it('shows the alias-resolved unit name(s), never the raw value twice', () => {
    render(
      <SessionAttributionRow
        item={itemFixture({ resolvedUnitNames: ['Willow 2', 'Willow 3'] })}
        onConfirm={vi.fn()}
        isConfirming={false}
      />
    )
    expect(screen.getByText('Willow 2 + Willow 3')).toBeInTheDocument()
  })

  it('says the cabin is not recognized when the alias table has no match', () => {
    render(
      <SessionAttributionRow
        item={itemFixture({ resolvedUnitNames: [] })}
        onConfirm={vi.fn()}
        isConfirming={false}
      />
    )
    expect(screen.getByText(/not recognized/i)).toBeInTheDocument()
  })

  it('offers a confirm action for every candidate weekend, labeled with its own name', () => {
    render(<SessionAttributionRow item={itemFixture()} onConfirm={vi.fn()} isConfirming={false} />)
    expect(screen.getByRole('button', { name: /This is Family Camp 2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /This is Family Camp 6/ })).toBeInTheDocument()
  })

  it('marks the suggested candidate, and only the suggested one, as the best guess', () => {
    render(<SessionAttributionRow item={itemFixture()} onConfirm={vi.fn()} isConfirming={false} />)
    expect(screen.getAllByText(/best guess/i)).toHaveLength(1)
  })

  it('confirms with the CLICKED candidate’s own session id, not the suggested one', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(
      <SessionAttributionRow item={itemFixture()} onConfirm={onConfirm} isConfirming={false} />
    )

    await user.click(screen.getByRole('button', { name: /This is Family Camp 6/ }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(1309519)
  })

  it('disables every confirm action while a confirm is in flight', () => {
    render(<SessionAttributionRow item={itemFixture()} onConfirm={vi.fn()} isConfirming={true} />)
    expect(screen.getByRole('button', { name: /This is Family Camp 2/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /This is Family Camp 6/ })).toBeDisabled()
  })

  it('flags an outdated row so staff know to skip it rather than pick a weekend', () => {
    render(
      <SessionAttributionRow
        item={itemFixture({ isStale: true })}
        onConfirm={vi.fn()}
        isConfirming={false}
      />
    )
    expect(screen.getByText(/outdated/i)).toBeInTheDocument()
  })

  it('offers no change-weekend affordance — confirmation is one-time, per the open kindred#2648 decision', () => {
    // A resolved row never reaches this component (the queue hook already
    // filters to is_resolved = false), so there is nothing here shaped like
    // an edit control at all: no "Undo", no "Change weekend". This test pins
    // that absence directly, since the failure mode is someone adding one
    // back onto a still-open row without re-reading why it isn't here.
    render(<SessionAttributionRow item={itemFixture()} onConfirm={vi.fn()} isConfirming={false} />)
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /change weekend/i })).not.toBeInTheDocument()
  })

  // Owner finding on kindred#2650: "the modal has household ID which is not
  // helpful, needs to show the family name". `familyName` is resolved by
  // each home differently (board roster vs. a per-household journey fetch on
  // the admin tab) and handed down as a plain string — this component stays
  // ignorant of where it came from.
  describe('the resolved family name', () => {
    it('shows the family name instead of the raw household id, when one resolves', () => {
      render(
        <SessionAttributionRow
          item={itemFixture()}
          onConfirm={vi.fn()}
          isConfirming={false}
          familyName="The Johnson Family"
        />
      )
      expect(screen.getByText(/The Johnson Family/)).toBeInTheDocument()
      expect(screen.queryByText(/2000001/)).not.toBeInTheDocument()
    })

    it('falls back to the raw household id when no name resolves — a poor id beats a blank row', () => {
      render(
        <SessionAttributionRow
          item={itemFixture()}
          onConfirm={vi.fn()}
          isConfirming={false}
          familyName={undefined}
        />
      )
      expect(screen.getByText(/2000001/)).toBeInTheDocument()
    })

    it('falls back to the raw household id when the resolved name is blank', () => {
      render(
        <SessionAttributionRow
          item={itemFixture()}
          onConfirm={vi.fn()}
          isConfirming={false}
          familyName=""
        />
      )
      expect(screen.getByText(/2000001/)).toBeInTheDocument()
    })

    it('never resolves a family name for a person-scoped row — the id stays', () => {
      render(
        <SessionAttributionRow
          item={itemFixture({ householdCmId: 0, personCmId: 3100001 })}
          onConfirm={vi.fn()}
          isConfirming={false}
          familyName="The Johnson Family"
        />
      )
      expect(screen.getByText(/3100001/)).toBeInTheDocument()
      expect(screen.queryByText(/The Johnson Family/)).not.toBeInTheDocument()
    })
  })

  describe('opening the family from the row', () => {
    it('renders the name as a click target that opens the family, when a handler is given', async () => {
      const onOpenFamily = vi.fn()
      const user = userEvent.setup()
      render(
        <SessionAttributionRow
          item={itemFixture()}
          onConfirm={vi.fn()}
          isConfirming={false}
          familyName="The Johnson Family"
          onOpenFamily={onOpenFamily}
        />
      )

      await user.click(screen.getByRole('button', { name: 'The Johnson Family' }))

      expect(onOpenFamily).toHaveBeenCalledTimes(1)
      expect(onOpenFamily).toHaveBeenCalledWith(2000001)
    })

    it('renders plain text, never a dead click, when no handler is given — the admin tab has nothing to open', () => {
      render(
        <SessionAttributionRow
          item={itemFixture()}
          onConfirm={vi.fn()}
          isConfirming={false}
          familyName="The Johnson Family"
        />
      )
      expect(screen.queryByRole('button', { name: 'The Johnson Family' })).not.toBeInTheDocument()
      expect(screen.getByText(/The Johnson Family/)).toBeInTheDocument()
    })

    it('never renders a click target for a person-scoped row, even if a handler is given', () => {
      render(
        <SessionAttributionRow
          item={itemFixture({ householdCmId: 0, personCmId: 3100001 })}
          onConfirm={vi.fn()}
          isConfirming={false}
          onOpenFamily={vi.fn()}
        />
      )
      expect(screen.queryByRole('button', { name: /3100001/ })).not.toBeInTheDocument()
    })
  })

  /**
   * Occupancy evidence — §12.8 of the round-2 triage-attack plan, owner-ruled
   * 2026-08-31 (Treatment A). Closes no issue and none is filed.
   *
   * The verdicts arrive COMPUTED from
   * `GET /api/lodging/attribution/conflicts`; nothing here classifies
   * anything, so these tests are about what the row SAYS, not about what is
   * true of a cabin.
   */
  describe('occupancy evidence', () => {
    const CONFLICT_CANDIDATE = {
      sessionCmId: 1309514,
      short: 'Family Camp 1',
      dateRange: 'May 22–25, 2026',
      isSuggested: false,
      verdict: 'conflict' as const,
      occupants: [
        {
          kind: 'placement' as const,
          label: 'The Weintraub Family',
          leafName: 'HC Upstairs 1',
          containerName: '',
        },
      ],
    }
    const FREE_CANDIDATE = {
      sessionCmId: 1309515,
      short: 'Family Camp 2',
      dateRange: 'Aug 20–23, 2026',
      isSuggested: true,
      verdict: 'free' as const,
      occupants: [],
    }
    const NO_DATA_CANDIDATE = {
      sessionCmId: 1309519,
      short: 'Family Camp 6',
      dateRange: 'Sep 24–27, 2026',
      isSuggested: false,
      verdict: 'no_data' as const,
      occupants: [],
    }

    /**
     * The conflict card's evidence line, read whole. `getByText(/Taken\./)`
     * would match the <strong> inside it, not the sentence.
     */
    function evidenceTextFor(container: HTMLElement, verdict: string): string {
      return (
        container.querySelector(`[data-verdict="${verdict}"] [data-evidence]`)?.textContent ?? ''
      )
    }

    function evidenceItem(over: Partial<SessionAttributionQueueItem> = {}) {
      return itemFixture({
        resolvedUnitNames: ['HC Upstairs 1'],
        candidates: [CONFLICT_CANDIDATE, FREE_CANDIDATE, NO_DATA_CANDIDATE],
        ...over,
      })
    }

    it('draws all three verdicts in IDENTICAL card chrome — Treatment A, not a tinted card', () => {
      // The ruling is an evidence line inside the card with the card's own
      // chrome unchanged ("for the sake of visual uniformity and
      // information"). Treatment B tinted the card itself and was not chosen,
      // so a per-verdict class on the CARD is the regression this pins.
      const { container } = render(
        <SessionAttributionRow item={evidenceItem()} onConfirm={vi.fn()} isConfirming={false} />
      )
      const cards = [...container.querySelectorAll('[data-verdict]')]
      expect(cards.map((card) => card.getAttribute('data-verdict'))).toEqual([
        'conflict',
        'free',
        'no_data',
      ])
      expect(new Set(cards.map((card) => card.className)).size).toBe(1)
    })

    it('draws an evidence line for every verdict, in the same box', () => {
      const { container } = render(
        <SessionAttributionRow item={evidenceItem()} onConfirm={vi.fn()} isConfirming={false} />
      )
      const lines = [...container.querySelectorAll('[data-evidence]')]
      expect(lines).toHaveLength(3)
      for (const line of lines) {
        expect(line.className).toContain(EVIDENCE_LINE)
      }
      // ...and the ONLY thing that differs between them is the colour.
      expect(new Set(lines.map((line) => line.className)).size).toBe(3)
    })

    it('names the occupant and the leaf on a conflict', () => {
      const { container } = render(
        <SessionAttributionRow item={evidenceItem()} onConfirm={vi.fn()} isConfirming={false} />
      )
      expect(evidenceTextFor(container, 'conflict')).toContain(
        'Taken. a placement for The Weintraub Family in HC Upstairs 1'
      )
    })

    it('says a conflicting leaf is a room inside the building the value named', () => {
      const { container } = render(
        <SessionAttributionRow
          item={evidenceItem({
            resolvedUnitNames: ['Clouds Rest'],
            candidates: [
              {
                ...CONFLICT_CANDIDATE,
                occupants: [
                  {
                    kind: 'placement',
                    label: 'The Delgado Family',
                    leafName: 'Clouds Rest Loft',
                    containerName: 'Clouds Rest',
                  },
                ],
              },
              FREE_CANDIDATE,
            ],
          })}
          onConfirm={vi.fn()}
          isConfirming={false}
        />
      )
      expect(evidenceTextFor(container, 'conflict')).toContain(
        'in Clouds Rest Loft — a room inside Clouds Rest'
      )
    })

    it('calls a write-in a write-in — write-ins count as occupancy (ruling 4)', () => {
      const { container } = render(
        <SessionAttributionRow
          item={evidenceItem({
            candidates: [
              {
                ...CONFLICT_CANDIDATE,
                occupants: [
                  {
                    kind: 'write_in',
                    label: 'Staff hold',
                    leafName: 'HC Upstairs 1',
                    containerName: '',
                  },
                ],
              },
              FREE_CANDIDATE,
            ],
          })}
          onConfirm={vi.fn()}
          isConfirming={false}
        />
      )
      expect(evidenceTextFor(container, 'conflict')).toContain('a write-in for Staff hold')
    })

    it('still says the cabin is taken when the rule found no nameable occupant', () => {
      // Arm 1 of the rule: `is_family_available` is false on its own — staff
      // marked the unit unavailable — so there is a conflict with nobody to
      // name. A blank sentence would read as a rendering bug.
      const { container } = render(
        <SessionAttributionRow
          item={evidenceItem({
            candidates: [{ ...CONFLICT_CANDIDATE, occupants: [] }, FREE_CANDIDATE],
          })}
          onConfirm={vi.fn()}
          isConfirming={false}
        />
      )
      expect(evidenceTextFor(container, 'conflict')).toContain(
        'HC Upstairs 1 is not available this weekend'
      )
    })

    it('words no_data as NO PLACEMENTS, never as "empty"', () => {
      // ⚠️ `no_data` means no placements, not no occupancy: a weekend nobody
      // has planned can still hold write-ins. Calling it empty would report an
      // absence of planning as a fact about the cabin.
      render(
        <SessionAttributionRow item={evidenceItem()} onConfirm={vi.fn()} isConfirming={false} />
      )
      expect(screen.getByText(/No placements recorded for Family Camp 6/)).toBeInTheDocument()
      expect(screen.queryByText(/empty/i)).not.toBeInTheDocument()
    })

    it('says the cabin is free for a free verdict', () => {
      render(
        <SessionAttributionRow item={evidenceItem()} onConfirm={vi.fn()} isConfirming={false} />
      )
      expect(screen.getByText(/HC Upstairs 1 is free this weekend/)).toBeInTheDocument()
    })

    it('draws nothing at all until the evidence loads — the row degrades, never blocks', () => {
      const { container } = render(
        <SessionAttributionRow item={itemFixture()} onConfirm={vi.fn()} isConfirming={false} />
      )
      expect(container.querySelectorAll('[data-evidence]')).toHaveLength(0)
      expect(container.querySelectorAll('[data-verdict]')).toHaveLength(0)
      expect(screen.queryByText(/Best guess moved/)).not.toBeInTheDocument()
      expect(screen.queryByText(/no weekend is a safe guess/)).not.toBeInTheDocument()
    })

    describe('the demotion banner', () => {
      it('names BOTH weekends when a conflict moved the guess off the date heuristic', () => {
        // Publishing both suggestions is what lets the row say "FC2, because
        // FC1 is taken" instead of silently disagreeing with the stored row.
        render(
          <SessionAttributionRow
            item={evidenceItem({
              demotion: { fromShort: 'Family Camp 1', toShort: 'Family Camp 2' },
            })}
            onConfirm={vi.fn()}
            isConfirming={false}
          />
        )
        const banner = screen.getByText(/Best guess moved to/).textContent
        expect(banner).toContain('Best guess moved to Family Camp 2')
        expect(banner).toContain('points at Family Camp 1')
        expect(banner).toContain('HC Upstairs 1')
      })

      it('stays away when nothing was demoted', () => {
        render(
          <SessionAttributionRow item={evidenceItem()} onConfirm={vi.fn()} isConfirming={false} />
        )
        expect(screen.queryByText(/Best guess moved to/)).not.toBeInTheDocument()
      })
    })

    describe('the every-candidate alarm', () => {
      const ALL_CONFLICT = {
        candidates: [
          CONFLICT_CANDIDATE,
          { ...FREE_CANDIDATE, verdict: 'conflict' as const, isSuggested: false },
        ],
        conflictInEveryCandidate: true,
      }

      it('points at the CABIN VALUE, not at a weekend', () => {
        render(
          <SessionAttributionRow
            item={evidenceItem(ALL_CONFLICT)}
            onConfirm={vi.fn()}
            isConfirming={false}
          />
        )
        const alarm = screen.getByText(/no weekend is a safe guess/).textContent
        expect(alarm).toContain('HC Upstairs 1 is occupied in every weekend')
        expect(alarm).toContain('the cabin CampMinder has recorded is out of date')
      })

      it('marks no candidate as the best guess — no weekend is safe to guess', () => {
        render(
          <SessionAttributionRow
            item={evidenceItem(ALL_CONFLICT)}
            onConfirm={vi.fn()}
            isConfirming={false}
          />
        )
        expect(screen.queryByText(/best guess/i)).not.toBeInTheDocument()
      })

      it('fires only when every candidate conflicts', () => {
        render(
          <SessionAttributionRow item={evidenceItem()} onConfirm={vi.fn()} isConfirming={false} />
        )
        expect(screen.queryByText(/no weekend is a safe guess/)).not.toBeInTheDocument()
      })
    })

    describe('the demoted candidate’s confirm button', () => {
      it('is dimmed but NOT disabled — a conflict never blocks confirmation', () => {
        render(
          <SessionAttributionRow item={evidenceItem()} onConfirm={vi.fn()} isConfirming={false} />
        )
        const button = screen.getByRole('button', { name: /This is Family Camp 1/ })
        expect(button).toBeEnabled()
        // SPLIT, never `toContain`. A substring match passes on a mangled
        // class name — `justify-centeropacity-45` contains "opacity-45" and
        // dims nothing, which is exactly what shipped here once.
        expect(button.className.split(' ')).toContain('opacity-45')
      })

      it('still confirms the conflicted weekend when staff click it anyway', async () => {
        const onConfirm = vi.fn()
        const user = userEvent.setup()
        render(
          <SessionAttributionRow item={evidenceItem()} onConfirm={onConfirm} isConfirming={false} />
        )

        await user.click(screen.getByRole('button', { name: /This is Family Camp 1/ }))

        expect(onConfirm).toHaveBeenCalledWith(1309514)
      })

      it('leaves an unconflicted candidate undimmed', () => {
        render(
          <SessionAttributionRow item={evidenceItem()} onConfirm={vi.fn()} isConfirming={false} />
        )
        expect(
          screen.getByRole('button', { name: /This is Family Camp 6/ }).className.split(' ')
        ).not.toContain('opacity-45')
      })
    })
  })
})
