import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { AidHeroBar, AidHeroCard, AidHeroKeys, type HeroSegment } from './HeroBar'

const SEGS: HeroSegment[] = [
  {
    key: 'accepted',
    value: 318,
    label: 'Accepted',
    figure: '318',
    tone: 'done',
    href: '/aid/requests?view=all',
  },
  { key: 'waiting', value: 9, label: 'Waiting on the family', figure: '9', tone: 'progress' },
  { key: 'offer', value: 31, label: 'Need an offer', figure: '31', tone: 'act', mine: true },
  { key: 'zero', value: 0, label: 'On hold', figure: '0', tone: 'act2', mine: true },
]
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('AidHeroBar', () => {
  it('draws a mid bar (the development funder bar) shorter than the full one and taller than compact', () => {
    const { container } = wrap(<AidHeroBar segments={SEGS} mid />)
    expect(container.firstElementChild?.className).toContain('h-[26px]')
    expect(container.firstElementChild?.className).not.toContain('h-[34px]')
  })
  it('draws one segment per non-zero value, sized by flex-grow, each titled', () => {
    wrap(<AidHeroBar segments={SEGS} />)
    const segs = screen.getAllByTestId('hero-seg')
    expect(segs).toHaveLength(3)
    expect(segs[0]).toHaveStyle({ flexGrow: '318' })
    expect(segs[2]).toHaveAttribute('title', 'Need an offer: 31')
  })
  it('labels a segment inside only when it is wide enough', () => {
    wrap(<AidHeroBar segments={SEGS} labelMinPct={6} />)
    const [accepted, waiting] = screen.getAllByTestId('hero-seg')
    expect(accepted?.textContent).toBe('318')
    expect(waiting?.textContent).toBe('') // 9 of 358 is 2.5%
  })
  it('labels at the threshold: just above shows the label, just below shows nothing', () => {
    const pair: HeroSegment[] = [
      { key: 'a', value: 7, label: 'Above', figure: '7', tone: 'done' },
      { key: 'b', value: 93, label: 'Rest', figure: '93', tone: 'light' },
    ]
    const { unmount } = wrap(<AidHeroBar segments={pair} labelMinPct={6} />)
    expect(screen.getAllByTestId('hero-seg')[0]?.textContent).toBe('7')
    unmount()
    wrap(
      <AidHeroBar
        segments={[
          { ...pair[0]!, value: 5 },
          { ...pair[1]!, value: 95 },
        ]}
        labelMinPct={6}
      />
    )
    expect(screen.getAllByTestId('hero-seg')[0]?.textContent).toBe('')
  })
  it('makes a segment with an href a link', () => {
    wrap(<AidHeroBar segments={SEGS} />)
    expect(screen.getAllByTestId('hero-seg')[0]?.tagName).toBe('A')
    expect(screen.getAllByTestId('hero-seg')[0]).toHaveAttribute('href', '/aid/requests?view=all')
  })
  it('draws the dashed budget marker at its share of the total', () => {
    wrap(<AidHeroBar segments={SEGS} total={400} marker={{ at: 300, title: 'Allocated $300' }} />)
    expect(screen.getByTestId('hero-marker')).toHaveStyle({ left: '75%' })
    expect(screen.getByTestId('hero-marker')).toHaveAttribute('title', 'Allocated $300')
  })
  it('reveals only when asked, and the compact bar never labels', () => {
    const { container, rerender } = wrap(<AidHeroBar segments={SEGS} reveal />)
    expect(container.querySelector('[data-reveal="true"]')).not.toBeNull()
    rerender(
      <MemoryRouter>
        <AidHeroBar segments={SEGS} compact />
      </MemoryRouter>
    )
    for (const seg of screen.getAllByTestId('hero-seg')) expect(seg.textContent).toBe('')
  })
})

describe('AidHeroKeys', () => {
  it("lists non-zero segments with bold figures, the viewer's own in amber", () => {
    wrap(<AidHeroKeys segments={SEGS} />)
    const keys = screen.getAllByTestId('hero-key')
    expect(keys.map((k) => k.textContent)).toEqual([
      'Accepted 318',
      'Waiting on the family 9',
      'Need an offer 31',
    ])
    expect(keys[2]?.className).toMatch(/amber/)
  })
})

describe('AidHeroCard', () => {
  it('puts the title left and the figure right with its label before it', () => {
    wrap(
      <AidHeroCard
        title="The season so far"
        description="412 requests"
        figure="86%"
        figureLabel="of live requests have an offer"
      >
        <div />
      </AidHeroCard>
    )
    expect(screen.getByRole('heading', { name: 'The season so far' })).toBeInTheDocument()
    const fig = screen.getByTestId('hero-figure')
    expect(fig.textContent).toBe('of live requests have an offer86%')
  })
})
