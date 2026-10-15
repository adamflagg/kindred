import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { ApiAidRulesDraft } from '../../../../types/api-types'
import { ChapterBar } from './ChapterBar'

// A draft whose first chapter's section holds two warnings: its chip carries a count badge.
const DRAFT = {
  sections: [{ section: 'income', status: { state: 'draft' }, errors: 0, warnings: 2 }],
} as unknown as ApiAidRulesDraft

describe('the chapter bar height (final mock season-rules.html: a 26px strip of 20px chips at 12px)', () => {
  it('draws the compact strip: 26px tall, 20px chips at 12px, 11.5px bold group labels', () => {
    render(
      <MemoryRouter>
        <ChapterBar draft={null} inView={1} budgetHref="/x" onJump={vi.fn()} />
      </MemoryRouter>
    )
    for (const strip of screen.getAllByTestId('chapter-strip'))
      expect(strip).toHaveClass('h-[26px]', 'p-0.5')
    const chip = screen.getByRole('button', { name: /^Tiers & equity/ })
    expect(chip).toHaveClass('h-5', 'text-xs', 'leading-4')
    expect(screen.getByRole('link', { name: /^Budget/ })).toHaveClass('h-5', 'text-xs')
    expect(screen.getByText('Awards', { selector: 'span' })).toHaveClass(
      'text-[11.5px]',
      'font-bold'
    )
  })

  it("draws a count badge at the mock's 14px line, so a badged chip stays 20px", () => {
    render(
      <MemoryRouter>
        <ChapterBar draft={DRAFT} inView={null} budgetHref="/x" onJump={vi.fn()} />
      </MemoryRouter>
    )
    const chip = screen.getByRole('button', { name: /^Tiers & equity/ })
    const badge = within(chip).getByText('2')
    // .chapbar .cs-chip .cs-badge: padding 0 6px, 11.5px / 16px (cs-type's default badge is 3px 8px, 12/18 and makes the chip 36px)
    expect(badge).toHaveClass('!py-0', '!px-[5px]', '!text-[10.5px]', '!leading-[14px]')
  })
})

describe('the chapter bar sticks under the app header (owner 2026-10-14)', () => {
  it('sticks at the app header’s height, not at the window’s top edge where the header covers it', () => {
    render(
      <MemoryRouter>
        <ChapterBar draft={null} inView={1} budgetHref="/x" onJump={vi.fn()} />
      </MemoryRouter>
    )
    const bar = screen.getByTestId('chapter-bar')
    expect(bar).toHaveClass('sticky', 'top-[var(--app-chrome-h,0px)]')
    expect(bar).not.toHaveClass('top-0')
  })
})

describe('the lead slot keeps its controls whole (owner 2026-10-14)', () => {
  it('lets the slot shrink only to its controls’ width, so a narrow bar scrolls instead of overlapping', () => {
    render(
      <MemoryRouter>
        <ChapterBar draft={null} inView={1} budgetHref="/x" onJump={vi.fn()}>
          <span>lead</span>
        </ChapterBar>
      </MemoryRouter>
    )
    const slot = screen.getByText('lead').parentElement as HTMLElement
    expect(slot).toHaveClass('min-w-min')
    expect(slot).not.toHaveClass('min-w-0')
  })
})
