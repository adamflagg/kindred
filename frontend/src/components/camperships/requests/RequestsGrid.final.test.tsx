/**
 * The Requests grid in the final design language (owner-approved final-v2/requests.html, 2026-10-09):
 * the Session cell in the ruled tiny words (§14), household requests named by their household (§15),
 * a native title on every cell that can be cut (§13), headers on one line with footnote marks (§8,
 * §12), and a footer on one line with the outside note in its own cell (§10). Fictional rows.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const downloadSpy = vi.fn()
vi.mock('../../../utils/csvExport', async (importActual) => ({
  ...(await importActual<typeof import('../../../utils/csvExport')>()),
  downloadCsv: (...args: unknown[]) => downloadSpy(...args),
}))

import type { ApiAidGridRow } from '../../../types/api-types'
import { gridRow, roundOut, ROW_EMMA, ROW_SAMUEL } from './gridFixtures'
import { RequestsGrid } from './RequestsGrid'
import { requestView } from './views'

const links = {
  href: (row: ApiAidGridRow) => `/aid/households/${String(row.household_cm_id)}?year=2027`,
  open: vi.fn(),
}
const MARKS = {
  decided: { n: 1, title: 'Decided: the award for a round.' },
  posted: { n: 2, title: 'Posted: what the round locked.' },
  cm_check: { n: 3, title: 'CM ✓: whether CampMinder matches.' },
  cost: { n: 4, title: "Cost: the session's list price." },
}

function Grid({
  slug = 'all',
  rows,
  extra = {},
}: {
  slug?: string
  rows: readonly ApiAidGridRow[]
  extra?: Partial<Parameters<typeof RequestsGrid>[0]>
}) {
  return (
    <MemoryRouter>
      <RequestsGrid
        rows={rows}
        view={requestView(slug)}
        showIds={false}
        tickedSeason
        today="2027-04-01"
        csvFilename="x.csv"
        highlighted={null}
        onHighlight={() => undefined}
        links={links}
        noteMarks={MARKS}
        {...extra}
      />
    </MemoryRouter>
  )
}

const HOUSEHOLD = gridRow({
  request_id: 'reqhh0000000001',
  camper_name: '',
  person_cm_id: 0,
  family_name: 'The Johnson Family',
  household_label: 'Mia & Noah Johnson',
  household_label_tiebreak: 'Riverside',
  session_name: 'Family Camp 4: Labor Day Weekend (w/ kids 10 and under)',
  session_type: 'family',
})

beforeEach(() => downloadSpy.mockClear())

describe('the Session column (§14: tiny everywhere)', () => {
  it('reads the ruled tiny words with the full name as the cell title', () => {
    render(
      <Grid rows={[HOUSEHOLD, gridRow({ session_name: 'Session 2', session_type: 'main' })]} />
    )
    const fc = screen.getByText('FC4').closest('td')
    expect(fc).toHaveAttribute('title', HOUSEHOLD.session_name)
    expect(screen.getByText('S2').closest('td')).toHaveAttribute('title', 'Session 2')
  })

  it('draws a dash with the unclear words when no session matched', () => {
    render(<Grid rows={[gridRow({ session_name: '', session_cm_id: 0 })]} />)
    const dash = screen.getAllByText('—')[0]?.closest('td')
    expect(dash).toHaveAttribute(
      'title',
      'Session unclear: no one enrolled session matches the request yet.'
    )
  })

  // ux3 requests-11 (owner): Session fits its names (name + 18), capped at the mock's 136.
  it('fits its names up to 136px, and the Camper is 170px', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollWidth', 'get')
    try {
      scroll.mockReturnValue(200)
      const { unmount } = render(<Grid rows={[ROW_EMMA]} />)
      const cols = screen.getByRole('table').querySelectorAll('col')
      expect((cols[0] as HTMLElement).style.width).toBe('170px')
      expect((cols[1] as HTMLElement).style.width).toBe('136px')
      unmount()
      scroll.mockReturnValue(50)
      render(<Grid rows={[ROW_EMMA]} />)
      expect(
        (screen.getByRole('table').querySelectorAll('col')[1] as HTMLElement).style.width
      ).toBe('68px')
    } finally {
      scroll.mockRestore()
    }
  })
})

// Final audit D-E2: a money cell can be cut in its narrow column, so it carries its full figure.
describe('a money cell title', () => {
  it('titles the Ask with the full figure, cents included', () => {
    const row = gridRow({ rounds: [roundOut(1, 'posted', { ask: 6866.41 })] })
    render(<Grid rows={[row]} />)
    const cells = screen.getAllByText('$6,866.41').map((el) => el.closest('td'))
    expect(cells[0]).toHaveAttribute('title', '$6,866.41')
  })
})

describe('a household-level request in the Camper column (§15)', () => {
  it('shows ⌂ and the household label as the usual name link, never "Household request"', () => {
    render(<Grid rows={[HOUSEHOLD]} />)
    const link = screen.getByRole('link', { name: 'Mia & Noah Johnson' })
    expect(link).toHaveAttribute('href', '/aid/households/1000001?year=2027')
    expect(screen.queryByText('Household request')).toBeNull()
    const cell = link.closest('td') as HTMLElement
    expect(cell.querySelector('svg')).not.toBeNull()
    expect(cell).toHaveAttribute(
      'title',
      'Household request (Family Camp): Mia & Noah Johnson · Riverside'
    )
  })

  it('mutes the tiebreak after the label, and only the tiebreak gives way', () => {
    render(<Grid rows={[HOUSEHOLD]} />)
    const tiebreak = screen.getByText('Riverside')
    expect(tiebreak.className).toMatch(/muted/)
    expect(tiebreak).toHaveClass('truncate')
    expect(screen.getByRole('link', { name: 'Mia & Noah Johnson' })).not.toHaveClass(
      'truncate-none'
    )
  })

  // Final audit M-E2: the label truncates WITH its own ellipsis (it can shrink: min-w-0, no
  // flex-none), and the tiebreak gives way first (shrink-[999]).
  it('lets the label shrink and truncate, and the tiebreak shrink first', () => {
    render(<Grid rows={[HOUSEHOLD]} />)
    const link = screen.getByRole('link', { name: 'Mia & Noah Johnson' })
    expect(link).toHaveClass('min-w-0', 'truncate')
    expect(link).not.toHaveClass('flex-none')
    expect(link).not.toHaveClass('max-w-full')
    expect(screen.getByText('Riverside')).toHaveClass('shrink-[999]')
  })

  // A household request with no label and no family name still has a link to open the household:
  // the dash camperLabel gives, never an empty anchor.
  it('draws a dash link when the household has neither a label nor a family name', () => {
    render(
      <Grid
        rows={[
          { ...HOUSEHOLD, household_label: '', household_label_tiebreak: '', family_name: '' },
        ]}
      />
    )
    expect(screen.getByRole('link', { name: '—' })).toHaveAttribute(
      'href',
      '/aid/households/1000001?year=2027'
    )
  })

  it('draws a camper as before, with no icon', () => {
    render(<Grid rows={[ROW_EMMA]} />)
    const cell = screen.getByRole('link', { name: 'Emma Johnson' }).closest('td') as HTMLElement
    expect(cell.querySelector('svg')).toBeNull()
    expect(cell).toHaveAttribute('title', 'Emma Johnson')
  })

  it('searches, and exports, by the label', async () => {
    render(<Grid rows={[HOUSEHOLD, ROW_EMMA]} />)
    await userEvent.type(screen.getByRole('searchbox'), 'Noah')
    expect(screen.getByRole('link', { name: 'Mia & Noah Johnson' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Emma Johnson' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [content] = downloadSpy.mock.calls.at(-1) as [string, string]
    expect(content.split('\n')[1]).toMatch(/^Mia & Noah Johnson,/)
  })
})

describe('every cell that can be cut carries a native title (§13)', () => {
  it('titles Requested by with the name, and the split marker with its words', () => {
    render(<Grid slug="needs-offer" rows={[gridRow({ payer_count: 2 })]} />)
    const cell = screen.getByText('Sarah Johnson').closest('td') as HTMLElement
    expect(cell).toHaveAttribute('title', 'Sarah Johnson · split between 2 households')
    const plain = render(<Grid rows={[ROW_EMMA]} />)
    expect(plain.container.querySelector('td[title="Sarah Johnson"]')).not.toBeNull()
  })

  it('titles the Needs attention chip with the chip and its fact', () => {
    const held = gridRow({
      queues: ['holds'],
      holds: [{ code: 'placeholder_income', severity: 'hold', message: 'Entered as $1.' }],
    })
    render(<Grid rows={[held]} />)
    const chip = screen.getByText('Placeholder income')
    expect(chip.getAttribute('title')).toMatch(/^Placeholder income: /)
  })
})

describe('headers on one line, with footnote marks (§8, §12)', () => {
  it('draws every header nowrap', () => {
    render(<Grid rows={[ROW_EMMA]} />)
    for (const th of screen.getAllByRole('columnheader')) {
      expect(th).toHaveClass('whitespace-nowrap')
    }
  })

  it('marks Decided¹, Posted², CM ✓³ and Cost⁴ with the notes as their titles', () => {
    render(<Grid rows={[ROW_EMMA]} />)
    const markOf = (header: RegExp) =>
      within(screen.getByRole('columnheader', { name: header })).getByRole('superscript', {
        hidden: true,
      })
    // Cost and Posted are on All; Decided is on Needs an offer.
    expect(markOf(/^Cost/)).toHaveTextContent('4')
    expect(markOf(/^Posted/)).toHaveAttribute('title', MARKS.posted.title)
    expect(markOf(/^CM ✓/)).toHaveTextContent('3')
  })

  it('marks Decided on Needs an offer', () => {
    render(<Grid slug="needs-offer" rows={[ROW_EMMA]} />)
    const th = screen.getByRole('columnheader', { name: /^Decided/ })
    expect(th.querySelector('sup')).toHaveAttribute('title', MARKS.decided.title)
  })

  it("carries the waiting view's Posted help in the header, never as a sentence row", () => {
    render(<Grid slug="waiting" rows={[ROW_SAMUEL]} />)
    expect(screen.getByRole('columnheader', { name: /^Posted/ })).toBeInTheDocument()
    expect(
      screen.queryByText('Posted is the amount posted in this round, not yet accepted.')
    ).toBeNull()
  })
})

describe('the footer is one line (§10)', () => {
  const outside = gridRow({
    request_id: 'reqsplit0000001',
    camper_name: 'Avery Testcamper',
    household_cm_id: 1000031,
    rounds: [roundOut(1, 'posted', { decided: 4800, posted: 4800, outside_budget: 500 })],
    total_decided: 4800,
    total_posted: 4800,
    stage: { round: 1, code: 'posted', label: 'R1 · Posted' },
    queues: [],
  })

  it('spans Camper through Session with its words as a title', () => {
    render(<Grid rows={[ROW_EMMA, outside]} />)
    const label = screen.getByText('2 requests · 2 families').closest('td') as HTMLElement
    expect(label).toHaveAttribute('colspan', '2')
    expect(label).toHaveAttribute('title', '2 requests · 2 families')
    expect(label).toHaveClass('truncate')
  })

  it('puts the outside note in the Requested by footer cell, one line, with its mark and title', () => {
    render(
      <Grid
        rows={[ROW_EMMA, outside]}
        extra={{ outsideMark: { n: 5, title: 'Outside: the part…' } }}
      />
    )
    const note = screen.getByText(
      (_, el) => el?.tagName === 'SPAN' && el.textContent === 'incl. $500 outside the budget5'
    )
    const cell = note.closest('td') as HTMLElement
    expect(cell).toHaveAttribute(
      'title',
      "The totals include $500 a named fund pays outside the budget; Rounds & budget doesn't count it."
    )
    expect(note).toHaveClass('truncate')
    expect(cell.querySelector('sup')).toHaveTextContent('5')
    // §12: the mark rides inside the one cut span (as the mock's .cf-cut), never as a flex item, where
    // vertical-align is ignored and the mark floated to the top of the cell.
    const mark = cell.querySelector('sup') as HTMLElement
    expect(mark.parentElement).toHaveClass('truncate')
    expect(mark.closest('.inline-flex')).toBeNull()
    const heads = screen.getAllByRole('columnheader').map((th) => th.textContent)
    const requestedBy = heads.findIndex((t) => t.startsWith('Requested by'))
    const footCells = Array.from((cell.closest('tfoot') as HTMLElement).querySelectorAll('td'))
    // The label cell spans two columns, so the footer has two fewer cells than the header.
    expect(footCells.indexOf(cell as HTMLTableCellElement)).toBe(requestedBy - 1)
  })
})

describe('the toolbar the page fills (§5)', () => {
  it('passes the pre-search slot and the search width through to the table', () => {
    render(
      <Grid
        rows={[ROW_EMMA]}
        extra={{
          toolbarBeforeSearch: <button type="button">Check Accepted…</button>,
          searchWidth: 180,
        }}
      />
    )
    expect(screen.getByRole('button', { name: 'Check Accepted…' })).toBeInTheDocument()
    expect((screen.getByRole('searchbox').parentElement as HTMLElement).style.width).toBe('180px')
  })
})

describe("the opened row's detail line (§15)", () => {
  it('says "Household request (Family Camp): label" before Requested by, for a household request only', () => {
    const { unmount } = render(
      <Grid rows={[HOUSEHOLD]} extra={{ highlighted: HOUSEHOLD.request_id }} />
    )
    const detail = document.querySelector('[data-aid-detail]') as HTMLElement
    // Flex children: the words are separate elements with no text between them.
    expect(detail.textContent).toContain(
      'Household request (Family Camp):Mia & Noah Johnson·Requested by'
    )
    expect(within(detail).getByText('Mia & Noah Johnson').tagName).toBe('B')
    unmount()
    render(<Grid rows={[ROW_EMMA]} extra={{ highlighted: ROW_EMMA.request_id }} />)
    expect(document.querySelector('[data-aid-detail]')).not.toHaveTextContent('Household request')
  })
})

describe('R3 pending approval (§13)', () => {
  it('titles the amber "pending $X" with what it means', () => {
    const pending = gridRow({
      rounds: [
        roundOut(1, 'posted', { decided: 1000, posted: 1000 }),
        roundOut(3, 'pending_approval', { pending_approval: 400 }),
      ],
    })
    render(<Grid rows={[pending]} />)
    expect(screen.getByText('pending $400').closest('td')).toHaveAttribute(
      'title',
      'Pending approval: $400, never summed until approved'
    )
  })
})
