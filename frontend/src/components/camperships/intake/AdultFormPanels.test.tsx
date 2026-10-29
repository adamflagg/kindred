/**
 * The opened adult-form row's three panels (adult aid form mock v2, steps 14–16; K2 a): the figures with each parse
 * note beside its figure, the special circumstances and signature, then the match evidence and the responses.
 * Fictional data (adultFormFixtures).
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AdultFormPanels } from './AdultFormPanels'
import { ADULT_SESSIONS, GRACE, HANNAH, JORDAN, response } from './adultFormFixtures'
import { sessionIndex } from './intakeModel'

const names = sessionIndex(ADULT_SESSIONS)
const panels = () => [...document.querySelectorAll<HTMLElement>('[data-adult-form-panels] > div')]

describe('AdultFormPanels', () => {
  it('draws three panels under a dashed amber rule: the form, its words, the match', () => {
    render(<AdultFormPanels response={response()} year={2027} names={names} />)
    expect(panels()).toHaveLength(3)
    expect(document.querySelector('[data-adult-form-panels]')?.className).toContain('border-dashed')
    expect(within(panels()[0]!).getByText('Adult aid form · Nov 5')).toBeInTheDocument()
    expect(within(panels()[1]!).getByText('Special circumstances')).toBeInTheDocument()
    expect(within(panels()[2]!).getByText('Match')).toBeInTheDocument()
    expect(within(panels()[2]!).getByText('Responses')).toBeInTheDocument()
  })

  it('lists the priced figures, then the answers that price nothing on one line', () => {
    render(<AdultFormPanels response={response()} year={2027} names={names} />)
    const left = panels()[0]!
    expect(within(left).getByText('2026 gross income')).toBeInTheDocument()
    expect(within(left).getByText('$80,000')).toBeInTheDocument()
    expect(
      within(left).getByText(
        'Also: mortgage none · rent $2,200 · student loans $250 · 0 dependents · unemployment no'
      )
    ).toBeInTheDocument()
  })

  it('K2 a: a parse note sits beside its figure, the typed words in plain ink', () => {
    render(<AdultFormPanels response={GRACE} year={2027} names={names} />)
    const note = document.querySelector('[data-figure="total_gross_income"] [data-note]')
    expect(note).toHaveTextContent('read “approx 85k” as $85,000')
    expect(note?.querySelector('[data-quoted]')).toHaveTextContent('“approx 85k”')
  })

  it('an unread figure reads unknown in amber italics, never $0', () => {
    render(<AdultFormPanels response={HANNAH} year={2027} names={names} />)
    const value = document.querySelector('[data-figure="expected_gross_income"] [data-value]')
    expect(value).toHaveTextContent('unknown')
    expect(value?.className).toContain('italic')
  })

  it('quotes the narrative and the signature; a blank narrative says so', () => {
    render(<AdultFormPanels response={response()} year={2027} names={names} />)
    expect(
      screen.getByText('“I lost my job in June and started a new one in September.”')
    ).toBeInTheDocument()
    expect(screen.getByText('Signed “Rachel Garcia”, Nov 5')).toBeInTheDocument()
    render(<AdultFormPanels response={GRACE} year={2027} names={names} />)
    expect(screen.getByText('Left blank')).toBeInTheDocument()
  })

  it('the match evidence with its clues in bold, and every response, this one in plain ink', () => {
    render(<AdultFormPanels response={JORDAN} year={2027} names={names} />)
    const right = panels()[2]!
    expect(within(right).getByText('name, birthdate and email').tagName).toBe('B')
    const items = within(right).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      'This response, Nov 4 · prices the request',
      'Second response, Nov 10, after a decision (2026 gross $58,000): flagged, not applied',
    ])
    expect(items[1]?.className).toContain('text-muted-foreground')
  })
})
