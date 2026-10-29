/**
 * The household page's Income with two answer sets, labelled by form (adult aid form design GF-2 B; mock v2 step 22):
 * each set opens on a green band row naming its form with Form intake's own source mark, who filed it and when, and
 * which requests it prices, with its own Income Correction…. Fictional names.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PILL } from '../kit/kitStyles'
import { answerSetHead } from './answerSets'
import { IncomeFormBand } from './IncomeFormBand'

const programs = { summer: 'At Camp', adult_weekend: "Women's Weekend", family_camp: 'Family Camp' }

describe('answerSetHead', () => {
  it("names CampMinder's form, who filed it, when, and the requests it prices", () => {
    expect(
      answerSetHead(
        {
          source: 'campminder',
          filed_by: 'Mia Johnson',
          filed_on: '2026-11-06',
          prices: [{ camper_name: 'Samuel Johnson', program_key: 'summer' }],
        },
        programs
      )
    ).toEqual({
      name: 'CampMinder aid form',
      meta: "Mia Johnson, Nov 6 · prices Samuel's At Camp request",
    })
  })

  it('names the adult aid form, and lists several requests it prices', () => {
    expect(
      answerSetHead(
        {
          source: 'google_form',
          filed_by: 'Mia Johnson',
          filed_on: '2026-11-05',
          prices: [
            { camper_name: 'Mia Johnson', program_key: 'adult_weekend' },
            { camper_name: 'Mia Johnson', program_key: 'family_camp' },
          ],
        },
        programs
      )
    ).toEqual({
      name: 'Adult aid form',
      meta: "Mia Johnson, Nov 5 · prices Mia's Women's Weekend and Family Camp requests",
    })
  })

  it('says when a set prices nothing yet', () => {
    expect(
      answerSetHead(
        { source: 'google_form', filed_by: 'Mia Johnson', filed_on: '2026-11-05', prices: [] },
        programs
      ).meta
    ).toBe('Mia Johnson, Nov 5 · prices no request yet')
  })
})

describe('IncomeFormBand', () => {
  it('is one green band row: the source mark, the form, its muted meta, and the correction slot', () => {
    render(
      <table>
        <tbody>
          <IncomeFormBand
            span={4}
            set={{
              source: 'google_form',
              filed_by: 'Mia Johnson',
              filed_on: '2026-11-05',
              prices: [{ camper_name: 'Mia Johnson', program_key: 'adult_weekend' }],
            }}
            programs={programs}
            correct={<button type="button">Income Correction…</button>}
          />
        </tbody>
      </table>
    )
    const row = screen.getByText('Adult aid form').closest('tr') as HTMLElement
    expect(row).toHaveAttribute('data-answer-set', 'google_form')
    const [band, slot] = within(row).getAllByRole('cell')
    expect(band).toHaveAttribute('colspan', '4')
    expect(band?.className).toContain('bg-[color-mix(in_oklab,var(--color-forest-200)')
    expect(within(band!).getByText('adult aid form').className).toBe(PILL.line)
    expect(
      within(band!).getByText("Mia Johnson, Nov 5 · prices Mia's Women's Weekend request")
    ).toBeInTheDocument()
    expect(within(slot!).getByRole('button', { name: 'Income Correction…' })).toBeInTheDocument()
  })
})
