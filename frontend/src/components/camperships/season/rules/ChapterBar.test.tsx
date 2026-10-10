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
