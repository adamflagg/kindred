import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { VelocityPaceCard } from './VelocityPaceCard'
import type { PaceModel, PaceRow } from './velocityPace'

function row(name: string, now: number, prior: number, more: Partial<PaceRow> = {}): PaceRow {
  const change = now - prior
  return {
    cmId: name.length,
    name,
    now,
    prior,
    change,
    level: Math.abs(change) <= 2,
    embedded: false,
    folded: [],
    ...more,
  }
}

const model: PaceModel = {
  rows: [
    row('Session 1', 200, 230),
    row('Session 3', 90, 92),
    row('Session 2', 250, 250),
    row('Quest', 1_212, 1_209),
    row('Session 2a', 108, 78, { embedded: true }),
  ],
  counts: { behind: 1, level: 2, ahead: 2, new: 1 },
  scale: 30,
  notOffered: [
    { name: 'Session 5', prior: 40 },
    { name: 'Session 1b', prior: 20 },
  ],
  canFold: true,
}

const props = {
  model,
  year: 2026,
  priorYear: 2025,
  basis: 'same_point' as const,
  firstNoteN: 2,
  fold: false,
  onFold: vi.fn(),
  pending: false,
}

function rowOf(name: string): HTMLElement {
  const hit = screen.getAllByText(name).find((el) => el.closest('[data-pace-row]'))
  return hit?.closest('[data-pace-row]') as HTMLElement
}

describe('VelocityPaceCard', () => {
  it('heads the card and captions the comparison with its numbered note (#98)', () => {
    render(<VelocityPaceCard {...props} />)
    expect(screen.getByRole('heading', { name: 'Pace vs last year' })).toBeInTheDocument()
    expect(screen.getByText(/vs same registration day last season/)).toHaveTextContent(
      'vs same registration day last season3'
    )
  })

  it('a past season reads final against final', () => {
    render(<VelocityPaceCard {...props} basis="final" />)
    expect(screen.getByText(/2026 final vs 2025 final/)).toBeInTheDocument()
    expect(screen.getByText(/2026’s registration year is over/)).toBeInTheDocument()
  })

  it('shows now vs last under every name, and the change as ▲ / ▼ or level (#94, #93)', () => {
    render(<VelocityPaceCard {...props} />)
    expect(within(rowOf('Session 1')).getByText('200 vs 230')).toBeInTheDocument()
    expect(within(rowOf('Session 1')).getByText('▼ 30')).toBeInTheDocument()
    expect(within(rowOf('Session 3')).getByText('level (−2)')).toBeInTheDocument()
    expect(within(rowOf('Session 2')).getByText('level')).toBeInTheDocument()
    expect(within(rowOf('Quest')).getByText('1,212 vs 1,209')).toBeInTheDocument()
    expect(within(rowOf('Quest')).getByText('▲ 3')).toBeInTheDocument()
    expect(within(rowOf('Session 2a')).getByText('108 vs 78 · embedded')).toBeInTheDocument()
  })

  it('draws a bar to scale for each change outside level, in the kit tokens (#99)', () => {
    render(<VelocityPaceCard {...props} />)
    const behind = rowOf('Session 1').querySelector('[data-pace-bar]') as HTMLElement
    expect(behind.style.width).toBe('50%')
    expect(behind.className).toMatch(/bg-red-600/)
    const ahead = rowOf('Quest').querySelector('[data-pace-bar]') as HTMLElement
    expect(ahead.style.width).toBe('5%')
    expect(ahead.className).toMatch(/bg-forest-600/)
    expect(rowOf('Session 3').querySelector('[data-pace-bar]')).toBeNull()
  })

  it('ranks into two columns (#101)', () => {
    render(<VelocityPaceCard {...props} />)
    const columns = screen.getAllByTestId('pace-column')
    expect(columns).toHaveLength(2)
    expect(
      within(columns[0]!)
        .getAllByText(/^(Session|Quest)/)
        .map((el) => el.textContent)
    ).toEqual(['Session 1', 'Session 3', 'Session 2'])
  })

  it('legend chips count each kind, and the hints are one visible line (#102)', () => {
    render(<VelocityPaceCard {...props} />)
    const legend = screen.getByTestId('pace-legend')
    expect(legend).toHaveTextContent('1 behind2 level2 ahead1 new')
    expect(
      screen.getByText(/^Behind: fewer enrolled than last season at this point\./)
    ).toHaveTextContent(
      'Behind: fewer enrolled than last season at this point. Level: within 2 campers of last season2, no bar. Ahead: more enrolled. New: didn’t run last season, so no pace to measure, not shown above.'
    )
  })

  it('numbers its notes after the page notes: level, then the comparison', () => {
    render(<VelocityPaceCard {...props} />)
    const notes = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(notes[0]).toMatch(/^2\. Level: a session within 2 campers of last season draws no bar/)
    expect(notes[1]).toMatch(/^3\. Same registration day: enrolled on day N/)
  })

  it('lists sessions not offered this year on one line under the card (#96)', () => {
    render(<VelocityPaceCard {...props} />)
    expect(screen.getByText(/^Not offered this year, so not paced:/)).toHaveTextContent(
      'Not offered this year, so not paced: Session 5 (40 last year) · Session 1b (20 last year).'
    )
  })

  it('offers the fold toggle on the card, defaulting to the not-offered line (#97)', () => {
    const onFold = vi.fn()
    render(<VelocityPaceCard {...props} onFold={onFold} />)
    const toggle = screen.getByRole('group', { name: 'Embedded sessions not offered' })
    expect(within(toggle).getByRole('button', { name: 'Not-offered line' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    fireEvent.click(within(toggle).getByRole('button', { name: 'Fold into main session' }))
    expect(onFold).toHaveBeenCalledWith(true)
  })

  it('folded, a row says so and the foot names what it holds', () => {
    const folded: PaceModel = {
      ...model,
      rows: [row('Session 1', 200, 250, { folded: [{ name: 'Session 1b', prior: 20 }] })],
      notOffered: [{ name: 'Session 5', prior: 40 }],
    }
    render(<VelocityPaceCard {...props} model={folded} fold />)
    expect(within(rowOf('Session 1')).getByText('200 vs 250 · incl. folded')).toBeInTheDocument()
    expect(screen.getByText(/^Folded, as Today does:/)).toHaveTextContent(
      'Folded, as Today does: Session 1 last year includes Session 1b (20).'
    )
  })

  it('hides the toggle when nothing can fold', () => {
    render(<VelocityPaceCard {...props} model={{ ...model, canFold: false }} />)
    expect(screen.queryByRole('group', { name: 'Embedded sessions not offered' })).toBeNull()
  })

  it('names the year when the comparison is not last season', () => {
    render(<VelocityPaceCard {...props} priorYear={2024} />)
    expect(screen.getByRole('heading', { name: 'Pace vs 2024' })).toBeInTheDocument()
    expect(screen.getByText(/vs same registration day in 2024/)).toBeInTheDocument()
    expect(screen.getByText(/^Not offered this year/)).toHaveTextContent('Session 5 (40 in 2024)')
  })

  it('on the priority date the bars wait for tomorrow (ruling 9)', () => {
    render(<VelocityPaceCard {...props} pending />)
    expect(screen.getByText('updates tomorrow')).toBeInTheDocument()
    expect(screen.queryByTestId('pace-column')).toBeNull()
  })
})
