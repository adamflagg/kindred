import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AidCards, AidFoldCard, AidLegend, AidMeter, AidShareBar } from './Cards'
import { AidSectionHead } from './SectionHead'

const FIGS = [
  { label: 'Allocated', note: <sup>1</sup>, value: '$972,125' },
  { label: 'Committed', value: '$198,209' },
  { label: 'Remaining', value: <b>$773,916</b>, title: 'Allocated − Committed', testId: 'rem' },
]

describe('AidFoldCard (kit §10)', () => {
  it('draws ONE header row: caret + bold title, meta, pills, figures with muted labels', () => {
    render(
      <AidFoldCard
        title="Camp & Quest"
        meta="87.5% of the budget"
        pills={[<span key="p">over its share</span>]}
        figures={FIGS}
        open={false}
        onToggle={vi.fn()}
        testId="card"
      />
    )
    const card = screen.getByTestId('card')
    const title = within(card).getByRole('button', { name: /Camp & Quest/ })
    expect(title).toHaveClass('font-bold')
    expect(title).toHaveTextContent('▸')
    expect(within(card).getByText('87.5% of the budget')).toHaveClass('text-muted-foreground')
    expect(within(card).getByText('over its share')).toBeInTheDocument()
    expect(within(card).getByText('Allocated')).toHaveClass('text-muted-foreground')
    expect(within(card).getByTestId('rem')).toHaveAttribute('title', 'Allocated − Committed')
  })

  it('has no caret and no button when it opens nothing (a static title)', () => {
    render(<AidFoldCard title="No pool" figures={FIGS} testId="card" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('No pool')).not.toHaveTextContent('▸')
  })

  it('folds: the body draws only when open, under a rule; the caret follows', async () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <AidFoldCard title="TBM" figures={FIGS} open={false} onToggle={onToggle}>
        <table data-testid="body" />
      </AidFoldCard>
    )
    expect(screen.queryByTestId('body')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /TBM/ }))
    expect(onToggle).toHaveBeenCalledOnce()
    rerender(
      <AidFoldCard title="TBM" figures={FIGS} open onToggle={onToggle}>
        <table data-testid="body" />
      </AidFoldCard>
    )
    expect(screen.getByTestId('body').parentElement).toHaveClass('border-t')
    expect(screen.getByRole('button', { name: /TBM/ })).toHaveTextContent('▾')
  })

  it('compact stacks each figure label over its value, bar and all, and a band card takes the green', () => {
    render(
      <AidCards count={4}>
        <AidFoldCard
          shape="compact"
          band
          title="Season"
          meta="100%"
          figures={FIGS}
          bar={<i data-testid="bar" />}
          testId="season"
        />
      </AidCards>
    )
    const card = screen.getByTestId('season')
    expect(card.className).toMatch(/forest-200/)
    const label = within(card).getByText('Committed')
    expect(label).toHaveClass('block')
    expect(within(card).getByTestId('bar')).toBeInTheDocument()
    expect(card.parentElement).toHaveStyle({ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' })
  })
})

describe('AidMeter, AidShareBar and AidLegend', () => {
  it('lays rounds end to end in their own shades, with amber stripes past 100%', () => {
    render(
      <AidMeter
        title="Camp & Quest: 98% committed"
        segments={[
          { tone: 'r1', left: 0, width: 60 },
          { tone: 'r2', left: 60, width: 40 },
          { tone: 'over', left: 70, width: 30 },
        ]}
      />
    )
    const meter = screen.getByTitle('Camp & Quest: 98% committed')
    expect(meter.querySelectorAll('i')).toHaveLength(3)
    expect(meter.querySelectorAll('i')[1]).toHaveStyle({ left: '60%', width: '40%' })
    expect(meter.querySelectorAll('i')[2]?.className).toMatch(/repeating-linear-gradient/)
  })

  it('an empty meter is a bare track with its reason in the title', () => {
    render(<AidMeter title="no allocation yet" segments={[]} />)
    expect(screen.getByTitle('no allocation yet').querySelectorAll('i')).toHaveLength(0)
  })

  it('the shares bar grows one segment per part and fills each by what it committed', () => {
    render(
      <AidShareBar
        segments={[
          { key: 'a', grow: 87.5, fill: 20, over: 0, tone: 'p0', title: 'Camp & Quest' },
          { key: 'b', grow: 4.2, fill: 100, over: 25, tone: 'p1', title: 'TBM' },
        ]}
      />
    )
    const a = screen.getByTitle('Camp & Quest')
    expect(a).toHaveStyle({ flex: '87.5 1 0' })
    expect(a.querySelector('i')).toHaveStyle({ width: '20%' })
    expect(screen.getByTitle('TBM').querySelectorAll('i')).toHaveLength(2)
  })

  it('a legend joins swatched items with a dot', () => {
    render(
      <AidLegend
        items={[
          { swatch: 'r1', label: 'Round 1 $187,277' },
          { swatch: 'r2', label: 'Round 2 $8,432' },
        ]}
      />
    )
    expect(screen.getByText('Round 1 $187,277')).toBeInTheDocument()
    expect(screen.getByText('·')).toBeInTheDocument()
  })
})

describe('AidSectionHead (kit thead)', () => {
  it('a plain heading is a 700 h2 with its summary right after and the right slot at the end', () => {
    render(
      <AidSectionHead
        title="Budget, 2027"
        description="rules v3 · counts when offered"
        right={<button type="button">Edit Plan…</button>}
        testId="head"
      />
    )
    const head = screen.getByTestId('head')
    expect(within(head).getByRole('heading', { name: 'Budget, 2027' })).toHaveClass('font-bold')
    expect(within(head).getByText('rules v3 · counts when offered')).toHaveClass(
      'text-muted-foreground'
    )
    expect(within(head).getByRole('button', { name: 'Edit Plan…' })).toBeInTheDocument()
  })

  it('a folding heading is a bold button with a caret, then the summary inline', async () => {
    const onToggle = vi.fn()
    render(
      <AidSectionHead
        title="Shown, not counted"
        note={<sup>6</sup>}
        description="outside grants $14,225"
        open={false}
        onToggle={onToggle}
      />
    )
    const button = screen.getByRole('button', { name: /Shown, not counted/ })
    expect(button).toHaveClass('font-bold')
    expect(button).toHaveTextContent('▸')
    await userEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
    expect(screen.getByText('outside grants $14,225')).toBeInTheDocument()
  })
})
