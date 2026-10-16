/**
 * Where a request came from (design-language rule 9, amended): "added" (staff made it with Add a Request…), "reg.
 * ask" (the dashboard made it from a registration ask) and the amber "reg. ask · review" (made from one, not yet
 * reviewed). One helper, so Requests, the household card and Form intake say them the same way.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PILL } from './kitStyles'
import { OriginMark } from './Pills'
import { ORIGIN_WORDS } from './words'

describe('OriginMark', () => {
  it.each([
    ['added', 'added', PILL.line],
    ['reg_ask', 'reg. ask', PILL.line],
    ['reg_ask_review', 'reg. ask · review', PILL.amber],
  ] as const)('%s reads "%s" on the StatusPill tone it is given', (origin, words, tone) => {
    render(<OriginMark origin={origin} title="Why it is here" />)
    const pill = screen.getByText(words)
    // the StatusPill dress: one line (truncate), 11.5/16 600, plus the help cursor a titled chip wears
    expect(pill.className).toBe(`${tone} cursor-help`)
    expect(pill).toHaveClass('truncate', 'text-[11.5px]', 'font-semibold')
    expect(pill).toHaveAttribute('title', 'Why it is here')
  })

  it('has the words a CSV or a sentence reuses, in sentence case', () => {
    expect(ORIGIN_WORDS).toEqual({
      added: 'added',
      reg_ask: 'reg. ask',
      reg_ask_review: 'reg. ask · review',
    })
  })
})
