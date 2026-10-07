import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { ApiAidRulesDraft } from '../../../../types/api-types'
import { ChapterBar } from './ChapterBar'

// A draft whose first chapter's section holds two warnings: its chip carries a count badge.
const DRAFT = {
  sections: [{ section: 'income', status: { state: 'draft' }, errors: 0, warnings: 2 }],
} as unknown as ApiAidRulesDraft

describe('the chapter bar height (rules-v3 "Fix 1": 50px at every width, every state)', () => {
  it("draws a count badge at the mock's 18px (16px line + border), so a chip stays 28px and the bar 50px", () => {
    render(
      <MemoryRouter>
        <ChapterBar draft={DRAFT} inView={null} budgetHref="/x" onJump={vi.fn()} />
      </MemoryRouter>
    )
    const chip = screen.getByRole('button', { name: /^Tiers & equity/ })
    const badge = within(chip).getByText('2')
    // .chapbar .cs-chip .cs-badge: padding 0 6px, 11.5px / 16px (cs-type's default badge is 3px 8px, 12/18 and makes the chip 36px)
    expect(badge).toHaveClass('!py-0', '!px-1.5', '!text-[11.5px]', '!leading-4')
  })
})
