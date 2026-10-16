/**
 * D-CUE (owner, 2026-10-15; epic #3207 PR 6): every card that opens a list shows an always-visible "›"
 * at the right end of its number row, turning forest green on hover. Never only on hover; a card
 * that opens nothing has none.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MetricCard } from './MetricCard'

describe('MetricCard — the › cue (D-CUE)', () => {
  it('a card that opens a list shows the cue in its number row, always visible', () => {
    const { container } = render(
      <MetricCard title="Total Enrolled" value={150} onClick={vi.fn()} />
    )

    const cue = container.querySelector('svg.lucide-chevron-right')
    expect(cue).not.toBeNull()
    expect(cue?.parentElement?.textContent).toContain('150')
    const cls = cue?.getAttribute('class') ?? ''
    expect(cls).toContain('text-muted-foreground')
    expect(cls).toContain('group-hover:text-forest-700')
    expect(cls).toContain('dark:group-hover:text-forest-300')
    expect(cls).toContain('ml-auto')
    expect(cls).not.toMatch(/(^|\s)(opacity-0|invisible|hidden)(\s|$)/)
    expect(container.firstElementChild?.className).toContain('group')
  })

  it('a card that opens nothing has no cue', () => {
    const { container } = render(<MetricCard title="Was Applied" value={3} />)
    expect(container.querySelector('svg.lucide-chevron-right')).toBeNull()
  })
})
